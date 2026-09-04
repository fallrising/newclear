package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.dto.CreatePostRequest;
import com.example.deck.model.Account;
import com.example.deck.model.ValidatedImage;
import com.example.deck.repository.AccountRepository;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.PostImagePersistenceService;
import com.example.deck.service.PostService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class PostAbuseSignalContractTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accounts;

    @Autowired
    private PostService postService;

    @Autowired
    private PostImagePersistenceService imagePersistenceService;

    @Autowired
    private ClientSignalHasher hasher;

    @Autowired
    private JdbcClient jdbc;

    private final List<Long> accountIds = new ArrayList<>();

    @AfterEach
    void deleteAccounts() {
        for (long accountId : accountIds) {
            jdbc.sql("DELETE FROM posts WHERE author_account_id = :id")
                    .param("id", accountId).update();
            jdbc.sql("DELETE FROM accounts WHERE id = :id").param("id", accountId).update();
        }
        accountIds.clear();
    }

    @Test
    void jsonPostStoresOnlyResolvedRemoteHmacAndRedactsResponse() throws Exception {
        Account actor = account("pas_json");
        AccountPrincipal principal = new AccountPrincipal(actor.id(), actor.handle(), null);
        String remoteAddress = "198.51.100.81";
        String spoofedForwardedAddress = "203.0.113.99";
        String expectedHmac = hasher.hashIp(remoteAddress);

        String response = mockMvc.perform(post("/api/posts")
                        .with(user(principal)).with(csrf()).with(request -> {
                            request.setRemoteAddr(remoteAddress);
                            return request;
                        })
                        .header("X-Forwarded-For", spoofedForwardedAddress)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"signal post\",\"channel\":\"home\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        JsonNode body = objectMapper.readTree(response);
        long postId = body.path("id").longValue();
        SignalRow signal = signalForActor(actor.id());
        assertThat(signal).isEqualTo(
                new SignalRow("POST_CREATED", actor.id(), postId, expectedHmac));
        assertThat(response).doesNotContain(
                remoteAddress, spoofedForwardedAddress, expectedHmac, "ipHmac", "actorAccountId");
        assertThat(signal.ipHmac()).isNotEqualTo(hasher.hashIp(spoofedForwardedAddress));
    }

    @Test
    void anonymousAndCsrfFailuresWriteNoSignal() throws Exception {
        Account actor = account("pas_auth");
        AccountPrincipal principal = new AccountPrincipal(actor.id(), actor.handle(), null);
        String json = "{\"content\":\"blocked\",\"channel\":\"home\"}";

        mockMvc.perform(post("/api/posts").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/posts").with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isForbidden());

        assertThat(signalCount(actor.id())).isZero();
        assertThat(postCount(actor.id())).isZero();
    }

    @Test
    void invalidSignalRollsBackPlainPost() {
        Account actor = account("pas_plain_rb");

        assertThatThrownBy(() -> postService.createPost(
                actor.id(), new CreatePostRequest("rollback", "home"), "invalid"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(postCount(actor.id())).isZero();
        assertThat(signalCount(actor.id())).isZero();
    }

    @Test
    void invalidSignalRollsBackImagePostAndMetadata() {
        Account actor = account("pas_image_rb");

        assertThatThrownBy(() -> imagePersistenceService.createOwnedWithImage(
                actor.id(), "rollback image", "home", "pas-image-rb", image(), "invalid"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(postCount(actor.id())).isZero();
        assertThat(imageCount(actor.id())).isZero();
        assertThat(signalCount(actor.id())).isZero();
    }

    @Test
    void imageTransactionCommitsPostMetadataAndOneSignal() {
        Account actor = account("pas_image_ok");
        String ipHmac = "a".repeat(64);

        var post = imagePersistenceService.createOwnedWithImage(
                actor.id(), "image", "home", "pas-image-ok", image(), ipHmac);

        assertThat(post.image()).isNotNull();
        assertThat(imageCount(actor.id())).isEqualTo(1);
        assertThat(signalForActor(actor.id()))
                .isEqualTo(new SignalRow("POST_CREATED", actor.id(), post.id(), ipHmac));
    }

    private Account account(String handle) {
        Account account = accounts.insert(handle, handle, "hash");
        accountIds.add(account.id());
        return account;
    }

    private ValidatedImage image() {
        return new ValidatedImage(
                new byte[] {1, 2, 3}, "image/jpeg", "jpg", 3, 1, 1, "b".repeat(64));
    }

    private long postCount(long actorId) {
        return jdbc.sql("SELECT COUNT(*) FROM posts WHERE author_account_id = :actorId")
                .param("actorId", actorId).query(Long.class).single();
    }

    private long imageCount(long actorId) {
        return jdbc.sql("""
                SELECT COUNT(*) FROM post_images image
                JOIN posts post ON post.id = image.post_id
                WHERE post.author_account_id = :actorId""")
                .param("actorId", actorId).query(Long.class).single();
    }

    private long signalCount(long actorId) {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_signals WHERE actor_account_id = :actorId")
                .param("actorId", actorId).query(Long.class).single();
    }

    private SignalRow signalForActor(long actorId) {
        return jdbc.sql("""
                SELECT action_kind, actor_account_id, post_id, ip_hmac
                FROM abuse_signals
                WHERE actor_account_id = :actorId""")
                .param("actorId", actorId)
                .query((rs, row) -> new SignalRow(
                        rs.getString("action_kind"),
                        rs.getLong("actor_account_id"),
                        rs.getLong("post_id"),
                        rs.getString("ip_hmac")))
                .single();
    }

    private record SignalRow(String action, long actorId, long postId, String ipHmac) {}
}
