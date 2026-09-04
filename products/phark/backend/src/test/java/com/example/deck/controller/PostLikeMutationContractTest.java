package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class PostLikeMutationContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private JdbcClient jdbcClient;

    private static final String PROBLEM_JSON = "application/problem+json";

    @Test
    void likeUnlikeLifecycleAndResendAreIdempotentAndAuthoritative() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "like lifecycle", "home");

        mutateLike(post.id(), false, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(likeState(post.id(), 1, true));
        assertThat(likeRelationCount(post.id(), actor.id())).isEqualTo(1);

        mutateLike(post.id(), false, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(likeState(post.id(), 1, true));
        assertThat(likeRelationCount(post.id(), actor.id())).isEqualTo(1);

        mutateLike(post.id(), true, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(likeState(post.id(), 0, false));
        assertThat(likeRelationCount(post.id(), actor.id())).isZero();

        mutateLike(post.id(), true, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(likeState(post.id(), 0, false));
        assertThat(likeRelationCount(post.id(), actor.id())).isZero();
    }

    @Test
    void interleavedActorsKeepOwnRelationsAndAuthoritativeCount() throws Exception {
        Account alice = newAccount();
        Account bob = newAccount();
        Post post = postRepository.insertOwned(alice.id(), "interleaved like", "home");

        mutateLike(post.id(), false, principal(alice), true)
                .andExpect(likeState(post.id(), 1, true));

        mutateLike(post.id(), false, principal(bob), true)
                .andExpect(likeState(post.id(), 2, true));

        mutateLike(post.id(), false, principal(alice), true)
                .andExpect(likeState(post.id(), 2, true));
        assertThat(likeRelationCount(post.id(), alice.id())).isEqualTo(1);
        assertThat(likeRelationCount(post.id(), bob.id())).isEqualTo(1);

        mutateLike(post.id(), true, principal(alice), true)
                .andExpect(likeState(post.id(), 1, false));
        assertThat(likeRelationCount(post.id(), alice.id())).isZero();
        assertThat(likeRelationCount(post.id(), bob.id())).isEqualTo(1);

        mutateLike(post.id(), true, principal(bob), true)
                .andExpect(likeState(post.id(), 0, false));
        assertThat(likeRelationCount(post.id(), bob.id())).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1"})
    void nonPositivePostIdReturnsInvalidPostIdForPutAndDelete(String postId) throws Exception {
        Account actor = newAccount();
        String url = "/api/posts/" + postId + "/like";

        mutateLike(url, false, principal(actor), true)
                .andExpect(problemCode(400, "INVALID_POST_ID"));
        mutateLike(url, true, principal(actor), true)
                .andExpect(problemCode(400, "INVALID_POST_ID"));
    }

    @Test
    void missingPositivePostIdReturnsPostNotFoundForPutAndDelete() throws Exception {
        Account actor = newAccount();
        long missing = Long.MAX_VALUE;

        mutateLike(missing, false, principal(actor), true)
                .andExpect(problemCode(404, "POST_NOT_FOUND"));
        mutateLike(missing, true, principal(actor), true)
                .andExpect(problemCode(404, "POST_NOT_FOUND"));
    }

    @Test
    void anonymousLikeAndUnlikeReturnAuthenticationRequiredWithNoRowChange() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "anonymous like blocked", "home");
        long before = likeCountInDb(post.id());

        mutateLike(post.id(), false, null, true)
                .andExpect(problemCode(401, "AUTHENTICATION_REQUIRED"));
        mutateLike(post.id(), true, null, true)
                .andExpect(problemCode(401, "AUTHENTICATION_REQUIRED"));

        assertThat(likeCountInDb(post.id())).isEqualTo(before);
        assertThat(likeRelationCount(post.id(), actor.id())).isZero();
    }

    @Test
    void authenticatedMutationWithoutCsrfReturnsForbiddenWithNoRowChange() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "csrf blocked like", "home");

        mutateLike(post.id(), false, principal(actor), false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));
        mutateLike(post.id(), true, principal(actor), false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));

        assertThat(likeCountInDb(post.id())).isZero();
        assertThat(likeRelationCount(post.id(), actor.id())).isZero();
    }

    @Test
    void selfLikeAndLegacyPostAreLikeable() throws Exception {
        Account author = newAccount();
        Post owned = postRepository.insertOwned(author.id(), "self like post", "home");

        mutateLike(owned.id(), false, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(likeState(owned.id(), 1, true));
        assertThat(likeRelationCount(owned.id(), author.id())).isEqualTo(1);

        Post legacy = postRepository.insert("Legacy Author", "legacy like post", "home");
        mutateLike(legacy.id(), false, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(likeState(legacy.id(), 1, true));
        assertThat(likeRelationCount(legacy.id(), author.id())).isEqualTo(1);

        mutateLike(legacy.id(), true, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(likeState(legacy.id(), 0, false));
        assertThat(likeRelationCount(legacy.id(), author.id())).isZero();
    }

    @Test
    void spoofedAccountIdInBodyCannotSelectActor() throws Exception {
        Account actor = newAccount();
        Account spoof = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "spoof like actor", "home");

        mockMvc.perform(put("/api/posts/" + post.id() + "/like")
                        .with(user(principal(actor)))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"accountId": %d, "postId": %d}
                                """.formatted(spoof.id(), post.id())))
                .andExpect(status().isOk())
                .andExpect(likeState(post.id(), 1, true));

        assertThat(singleLikeAccountId(post.id())).isEqualTo(actor.id());
        assertThat(likeRelationCount(post.id(), spoof.id())).isZero();
    }

    @Test
    void likeMutationKeepsPostTimestampAndCursorMembership() throws Exception {
        Account author = newAccount();
        Post post = postRepository.insertOwned(author.id(), "like keeps cursor", "home");

        Instant createdAtBefore = post.createdAt();
        JsonNode pageBefore = timelineHome(100);
        List<Long> idsBefore = itemIds(pageBefore);
        String cursorBefore = nextCursor(pageBefore);

        mutateLike(post.id(), false, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(likeState(post.id(), 1, true));

        assertThat(postRepository.findById(post.id()).orElseThrow().createdAt())
                .as("like mutation must not change post timestamp")
                .isEqualTo(createdAtBefore);

        JsonNode pageAfter = timelineHome(100);
        assertThat(itemIds(pageAfter))
                .as("like mutation must not change timeline membership or ordering")
                .containsExactlyElementsOf(idsBefore);
        assertThat(nextCursor(pageAfter))
                .as("like mutation must not change cursor membership")
                .isEqualTo(cursorBefore);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private Account newAccount() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String handle = "plm" + suffix;
        return accountRepository.insert(handle, "Like Mutator " + suffix, "unused-hash");
    }

    private static AccountPrincipal principal(Account account) {
        return new AccountPrincipal(account.id(), account.handle(), null);
    }

    private ResultActions mutateLike(
            long postId, boolean unlike, AccountPrincipal principal, boolean withCsrf)
            throws Exception {
        return mutateLike("/api/posts/" + postId + "/like", unlike, principal, withCsrf);
    }

    private ResultActions mutateLike(
            String url, boolean unlike, AccountPrincipal principal, boolean withCsrf)
            throws Exception {
        MockHttpServletRequestBuilder request = unlike ? delete(url) : put(url);
        if (principal != null) {
            request.with(user(principal));
        }
        if (withCsrf) {
            request.with(csrf());
        }
        return mockMvc.perform(request);
    }

    private JsonNode timelineHome(int limit) throws Exception {
        String body = mockMvc.perform(get("/api/posts")
                        .param("channel", "home")
                        .param("limit", Integer.toString(limit)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(body);
    }

    private static List<Long> itemIds(JsonNode page) {
        List<Long> ids = new ArrayList<>();
        page.path("items").forEach(item -> ids.add(item.path("id").asLong()));
        return ids;
    }

    private static String nextCursor(JsonNode page) {
        return page.path("nextCursor").isNull() ? null : page.path("nextCursor").asText();
    }

    private long likeRelationCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_likes
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long likeCountInDb(long postId) {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM post_likes WHERE post_id = :postId")
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private long singleLikeAccountId(long postId) {
        return jdbcClient
                .sql("SELECT account_id FROM post_likes WHERE post_id = :postId")
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private static ResultMatcher likeState(long postId, long likeCount, boolean likedByViewer) {
        return result -> {
            jsonPath("$.postId").value(postId).match(result);
            jsonPath("$.likeCount").value(likeCount).match(result);
            jsonPath("$.likedByViewer").value(likedByViewer).match(result);
        };
    }

    private static ResultMatcher problemCode(int expectedStatus, String code) {
        return result -> {
            status().is(expectedStatus).match(result);
            content().contentTypeCompatibleWith(PROBLEM_JSON).match(result);
            jsonPath("$.code").value(code).match(result);
        };
    }
}
