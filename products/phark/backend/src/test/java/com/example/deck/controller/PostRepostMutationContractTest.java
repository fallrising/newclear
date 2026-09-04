package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostLikeRepository;
import com.example.deck.repository.PostRepostRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
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
class PostRepostMutationContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private PostRepostRepository postRepostRepository;

    @Autowired
    private PostLikeRepository postLikeRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private JdbcClient jdbcClient;

    private static final String PROBLEM_JSON = "application/problem+json";

    @Test
    void putDeleteLifecycleAndResendAreIdempotentAndAuthoritative() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "repost lifecycle", "home");

        mutateRepost(post.id(), false, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(repostState(post.id(), 1, true));
        assertThat(repostRelationCount(post.id(), actor.id())).isEqualTo(1);

        mutateRepost(post.id(), false, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 1, true));
        assertThat(repostRelationCount(post.id(), actor.id())).isEqualTo(1);

        mutateRepost(post.id(), true, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 0, false));
        assertThat(repostRelationCount(post.id(), actor.id())).isZero();

        mutateRepost(post.id(), true, principal(actor), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 0, false));
        assertThat(repostRelationCount(post.id(), actor.id())).isZero();
    }

    @Test
    void repeatedPutNeitherDuplicatesRelationNorActivityNorChangesRelationCreatedAt() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "repost no duplicate", "home");

        mutateRepost(post.id(), false, principal(actor), true)
                .andExpect(repostState(post.id(), 1, true));
        setRelationCreatedAt(post.id(), actor.id(), "2000-01-01 00:00:00");
        Instant firstCreatedAt = relationCreatedAt(post.id(), actor.id());

        mutateRepost(post.id(), false, principal(actor), true)
                .andExpect(repostState(post.id(), 1, true));
        assertThat(repostRelationCount(post.id(), actor.id())).isEqualTo(1);
        assertThat(relationCreatedAt(post.id(), actor.id()))
                .as("repeated PUT must not change relation created_at")
                .isEqualTo(firstCreatedAt);

        long activityCount = repostActivityCount(post.id(), actor.id());
        assertThat(activityCount)
                .as("repeated PUT must not create additional activities")
                .isEqualTo(1);
    }

    @Test
    void twoActorsProduceSharedCountTwoAndDeletingOneRemovesOnlyThatActor() throws Exception {
        Account alice = newAccount();
        Account bob = newAccount();
        Post post = postRepository.insertOwned(alice.id(), "shared repost count", "home");

        mutateRepost(post.id(), false, principal(alice), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 1, true));
        long aliceRepostId = relationId(alice.id(), post.id());
        mutateRepost(post.id(), false, principal(bob), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 2, true));
        long bobRepostId = relationId(bob.id(), post.id());

        mutateRepost(post.id(), true, principal(alice), true)
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 1, false));

        assertThat(repostRelationCount(post.id(), alice.id())).isZero();
        assertThat(repostRelationCount(post.id(), bob.id())).isEqualTo(1);
        assertThat(repostActivityCount(post.id(), bob.id())).isEqualTo(1);

        JsonNode timeline = getTimelineAs(null, "home", 100);
        Set<String> entryIds = new HashSet<>();
        timeline.path("items").forEach(item ->
                entryIds.add(item.path("timelineEntryId").asText()));
        assertThat(entryIds)
                .contains("post:" + post.id())
                .contains("repost:" + bobRepostId);
        assertThat(entryIds)
                .doesNotContain("repost:" + aliceRepostId);
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1"})
    void nonPositivePostIdReturnsInvalidPostIdForPutAndDelete(String postId) throws Exception {
        Account actor = newAccount();
        String url = "/api/posts/" + postId + "/repost";

        mutateRepost(url, false, principal(actor), true)
                .andExpect(problemCode(400, "INVALID_POST_ID"));
        mutateRepost(url, true, principal(actor), true)
                .andExpect(problemCode(400, "INVALID_POST_ID"));
    }

    @Test
    void missingPositivePostIdReturnsPostNotFoundForPutAndDelete() throws Exception {
        Account actor = newAccount();
        long missing = Long.MAX_VALUE;

        mutateRepost(missing, false, principal(actor), true)
                .andExpect(problemCode(404, "POST_NOT_FOUND"));
        mutateRepost(missing, true, principal(actor), true)
                .andExpect(problemCode(404, "POST_NOT_FOUND"));
    }

    @Test
    void anonymousWithValidCsrfReturnsAuthRequiredWithNoRowChange() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "anonymous repost blocked", "home");
        long beforeCount = repostCountInDb(post.id());

        mutateRepost(post.id(), false, null, true)
                .andExpect(problemCode(401, "AUTHENTICATION_REQUIRED"));
        mutateRepost(post.id(), true, null, true)
                .andExpect(problemCode(401, "AUTHENTICATION_REQUIRED"));

        assertThat(repostCountInDb(post.id())).isEqualTo(beforeCount);
        assertThat(repostRelationCount(post.id(), actor.id())).isZero();
        assertThat(postRepostActivityCount(post.id())).isZero();
    }

    @Test
    void anonymousWithoutCsrfReturnsCsrfInvalidWithNoRowChange() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "anonymous no csrf repost blocked", "home");
        long beforeCount = repostCountInDb(post.id());

        mutateRepost(post.id(), false, null, false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));
        mutateRepost(post.id(), true, null, false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));

        assertThat(repostCountInDb(post.id())).isEqualTo(beforeCount);
        assertThat(repostRelationCount(post.id(), actor.id())).isZero();
        assertThat(postRepostActivityCount(post.id())).isZero();
    }

    @Test
    void authenticatedWithoutCsrfReturnsForbiddenWithNoRowChange() throws Exception {
        Account actor = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "csrf blocked repost", "home");

        mutateRepost(post.id(), false, principal(actor), false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));
        mutateRepost(post.id(), true, principal(actor), false)
                .andExpect(problemCode(403, "CSRF_TOKEN_INVALID"));

        assertThat(repostCountInDb(post.id())).isZero();
        assertThat(repostRelationCount(post.id(), actor.id())).isZero();
        assertThat(postRepostActivityCount(post.id())).isZero();
    }

    @Test
    void selfRepostAndLegacyPostRepostSucceed() throws Exception {
        Account author = newAccount();
        Post owned = postRepository.insertOwned(author.id(), "self repost post", "home");

        mutateRepost(owned.id(), false, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(repostState(owned.id(), 1, true));
        assertThat(repostRelationCount(owned.id(), author.id())).isEqualTo(1);

        Post legacy = postRepository.insert("Legacy Author", "legacy repost post", "home");
        mutateRepost(legacy.id(), false, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(repostState(legacy.id(), 1, true));
        assertThat(repostRelationCount(legacy.id(), author.id())).isEqualTo(1);

        mutateRepost(legacy.id(), true, principal(author), true)
                .andExpect(status().isOk())
                .andExpect(repostState(legacy.id(), 0, false));
        assertThat(repostRelationCount(legacy.id(), author.id())).isZero();
    }

    @Test
    void spoofedAccountIdInBodyCannotSelectActor() throws Exception {
        Account actor = newAccount();
        Account spoof = newAccount();
        Post post = postRepository.insertOwned(actor.id(), "spoof repost actor", "home");

        mockMvc.perform(put("/api/posts/" + post.id() + "/repost")
                        .with(user(principal(actor)))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"accountId": %d, "postId": %d}
                                """.formatted(spoof.id(), post.id())))
                .andExpect(status().isOk())
                .andExpect(repostState(post.id(), 1, true));

        assertThat(singleRepostAccountId(post.id())).isEqualTo(actor.id());
        assertThat(repostRelationCount(post.id(), spoof.id())).isZero();
    }

    @Test
    void mutationPreservesOriginalContentChannelCreatedAtExistingLikeAndReplyNeverRepostOfRepost()
            throws Exception {
        Account author = newAccount();
        Account reposter = newAccount();
        Account liker = newAccount();

        Post original = postRepository.insertOwned(author.id(), "original content", "tech");

        replyRepository.insertOwned(original.id(), liker.id(), "a reply");
        postLikeRepository.like(original.id(), liker.id());

        Instant createdAtBefore = original.createdAt();
        String contentBefore = original.content();
        String channelBefore = original.channel();

        mutateRepost(original.id(), false, principal(reposter), true)
                .andExpect(status().isOk())
                .andExpect(repostState(original.id(), 1, true));

        assertThat(postRepository.findById(original.id()).orElseThrow().createdAt())
                .as("repost must not change original created_at")
                .isEqualTo(createdAtBefore);
        assertThat(postRepository.findById(original.id()).orElseThrow().content())
                .as("repost must not change original content")
                .isEqualTo(contentBefore);
        assertThat(postRepository.findById(original.id()).orElseThrow().channel())
                .as("repost must not change original channel")
                .isEqualTo(channelBefore);

        JsonNode postRow = getPostRow(original.id());
        assertThat(postRow.path("likeCount").asLong()).isEqualTo(1);
        assertThat(postRow.path("replyCount").asLong()).isEqualTo(1);

        assertThat(postRepostActivityCount(original.id())).isEqualTo(1);

        JsonNode timeline = getTimelineAs(null, "tech", 100);
        JsonNode repostCopy = findPostByTimelineEntry(
                timeline, "repost:" + relationId(reposter.id(), original.id()));
        assertThat(repostCopy.path("id").asLong())
                .as("repost activity must use original id, not relation id")
                .isEqualTo(original.id());
        assertThat(repostCopy.path("author").asText())
                .as("repost must show original author")
                .isEqualTo(author.displayName());
        assertThat(repostCopy.path("content").asText())
                .as("repost must show original content")
                .isEqualTo("original content");
        assertThat(repostCopy.path("channel").asText())
                .as("repost must show original channel")
                .isEqualTo("tech");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private Account newAccount() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String handle = "prm" + suffix;
        return accountRepository.insert(handle, "Repost Mutator " + suffix, "unused-hash");
    }

    private static AccountPrincipal principal(Account account) {
        return new AccountPrincipal(account.id(), account.handle(), null);
    }

    private ResultActions mutateRepost(
            long postId, boolean unrepost, AccountPrincipal principal, boolean withCsrf)
            throws Exception {
        return mutateRepost("/api/posts/" + postId + "/repost", unrepost, principal, withCsrf);
    }

    private ResultActions mutateRepost(
            String url, boolean unrepost, AccountPrincipal principal, boolean withCsrf)
            throws Exception {
        MockHttpServletRequestBuilder request = unrepost ? delete(url) : put(url);
        if (principal != null) {
            request.with(user(principal));
        }
        if (withCsrf) {
            request.with(csrf());
        }
        return mockMvc.perform(request);
    }

    private JsonNode getTimelineAs(Account viewer, String channel, int limit) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/posts")
                .param("channel", channel)
                .param("limit", Integer.toString(limit));
        if (viewer != null) {
            request.with(user(principal(viewer)));
        }
        String body = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(body);
    }

    private static JsonNode findPostByTimelineEntry(JsonNode page, String timelineEntryId) {
        for (JsonNode item : page.path("items")) {
            if (timelineEntryId.equals(item.path("timelineEntryId").asText())) {
                return item;
            }
        }
        throw new AssertionError(
                "Expected timeline entry '" + timelineEntryId + "' in page");
    }

    private long repostRelationCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long repostCountInDb(long postId) {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM post_reposts WHERE post_id = :postId")
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private long singleRepostAccountId(long postId) {
        return jdbcClient
                .sql("SELECT account_id FROM post_reposts WHERE post_id = :postId")
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private long relationId(long accountId, long postId) {
        return jdbcClient
                .sql("SELECT id FROM post_reposts WHERE account_id = :accountId AND post_id = :postId")
                .param("accountId", accountId)
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private Instant relationCreatedAt(long postId, long accountId) {
        String ts = jdbcClient
                .sql("""
                        SELECT created_at FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(String.class)
                .single();
        return java.time.LocalDateTime.parse(ts,
                        java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                .toInstant(java.time.ZoneOffset.UTC);
    }

    private void setRelationCreatedAt(long postId, long accountId, String createdAt) {
        jdbcClient
                .sql("""
                        UPDATE post_reposts SET created_at = :createdAt
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("createdAt", createdAt)
                .param("postId", postId)
                .param("accountId", accountId)
                .update();
    }

    private long repostActivityCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long postRepostActivityCount(long postId) {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM post_reposts WHERE post_id = :postId")
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private JsonNode getPostRow(long postId) throws Exception {
        JsonNode timeline = getTimelineAs(null, "tech", 100);
        return findPostByTimelineEntry(timeline, "post:" + postId);
    }

    private static ResultMatcher repostState(
            long postId, long repostCount, boolean repostedByViewer) {
        return result -> {
            jsonPath("$.postId").value(postId).match(result);
            jsonPath("$.repostCount").value(repostCount).match(result);
            jsonPath("$.repostedByViewer").value(repostedByViewer).match(result);
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
