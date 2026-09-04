package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.dto.CreateReplyRequest;
import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.ReplyService;
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
class ReplyAbuseSignalContractTest {
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accounts;

    @Autowired
    private PostRepository posts;

    @Autowired
    private ReplyService replyService;

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
    void replyNotificationAndResolvedRemoteSignalCommitTogether() throws Exception {
        Account owner = account("ras_owner");
        Account actor = account("ras_actor");
        Post post = posts.insertOwned(owner.id(), "post", "home");
        AccountPrincipal principal = new AccountPrincipal(actor.id(), actor.handle(), null);
        String remoteAddress = "198.51.100.82";
        String spoofedForwardedAddress = "203.0.113.98";
        String expectedHmac = hasher.hashIp(remoteAddress);

        String response = mockMvc.perform(post("/api/posts/" + post.id() + "/replies")
                        .with(user(principal)).with(csrf()).with(request -> {
                            request.setRemoteAddr(remoteAddress);
                            return request;
                        })
                        .header("X-Forwarded-For", spoofedForwardedAddress)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"reply signal\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();

        JsonNode body = objectMapper.readTree(response);
        long replyId = body.path("id").longValue();
        SignalRow signal = signalForActor(actor.id());
        assertThat(signal).isEqualTo(
                new SignalRow("REPLY_CREATED", actor.id(), replyId, expectedHmac));
        assertThat(notificationCount(owner.id(), actor.id(), replyId)).isEqualTo(1);
        assertThat(response).doesNotContain(
                remoteAddress, spoofedForwardedAddress, expectedHmac, "ipHmac", "actorAccountId");
        assertThat(signal.ipHmac()).isNotEqualTo(hasher.hashIp(spoofedForwardedAddress));
    }

    @Test
    void invalidSignalRollsBackReplyAndNotification() {
        Account owner = account("ras_rb_owner");
        Account actor = account("ras_rb_actor");
        Post post = posts.insertOwned(owner.id(), "post", "home");

        assertThatThrownBy(() -> replyService.createReply(
                post.id(), actor.id(), new CreateReplyRequest("rollback"), "invalid"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(replyCount(post.id(), actor.id())).isZero();
        assertThat(notificationCount(owner.id(), actor.id(), null)).isZero();
        assertThat(signalCount(actor.id())).isZero();
    }

    @Test
    void anonymousAndCsrfFailuresWriteNothing() throws Exception {
        Account owner = account("ras_auth_owner");
        Account actor = account("ras_auth_actor");
        Post post = posts.insertOwned(owner.id(), "post", "home");
        AccountPrincipal principal = new AccountPrincipal(actor.id(), actor.handle(), null);
        String json = "{\"content\":\"blocked\"}";

        mockMvc.perform(post("/api/posts/" + post.id() + "/replies").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/posts/" + post.id() + "/replies").with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON).content(json))
                .andExpect(status().isForbidden());

        assertThat(replyCount(post.id(), actor.id())).isZero();
        assertThat(signalCount(actor.id())).isZero();
        assertThat(notificationCount(owner.id(), actor.id(), null)).isZero();
    }

    private Account account(String handle) {
        Account account = accounts.insert(handle, handle, "hash");
        accountIds.add(account.id());
        return account;
    }

    private long replyCount(long postId, long actorId) {
        return jdbc.sql("""
                SELECT COUNT(*) FROM replies
                WHERE post_id = :postId AND author_account_id = :actorId""")
                .param("postId", postId).param("actorId", actorId)
                .query(Long.class).single();
    }

    private long notificationCount(long ownerId, long actorId, Long replyId) {
        String sql = """
                SELECT COUNT(*) FROM notifications
                WHERE recipient_account_id = :ownerId
                  AND actor_account_id = :actorId
                  AND type = 'REPLY'""";
        if (replyId != null) {
            sql += " AND reply_id = :replyId";
        }
        var statement = jdbc.sql(sql).param("ownerId", ownerId).param("actorId", actorId);
        if (replyId != null) {
            statement = statement.param("replyId", replyId);
        }
        return statement.query(Long.class).single();
    }

    private long signalCount(long actorId) {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_signals WHERE actor_account_id = :actorId")
                .param("actorId", actorId).query(Long.class).single();
    }

    private SignalRow signalForActor(long actorId) {
        return jdbc.sql("""
                SELECT action_kind, actor_account_id, reply_id, ip_hmac
                FROM abuse_signals
                WHERE actor_account_id = :actorId""")
                .param("actorId", actorId)
                .query((rs, row) -> new SignalRow(
                        rs.getString("action_kind"),
                        rs.getLong("actor_account_id"),
                        rs.getLong("reply_id"),
                        rs.getString("ip_hmac")))
                .single();
    }

    private record SignalRow(String action, long actorId, long replyId, String ipHmac) {}
}
