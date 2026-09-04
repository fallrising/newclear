package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.model.NotificationCursor;
import com.example.deck.model.NotificationType;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.NotificationReadRepository;
import com.example.deck.repository.NotificationRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.NotificationCursorCodec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Iterator;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class NotificationControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private NotificationRepository notificationRepository;

    @Autowired
    private NotificationReadRepository notificationReadRepository;

    @Autowired
    private NotificationCursorCodec cursorCodec;

    private static final String PROBLEM_JSON = "application/problem+json";

    private static final String POST_CONTENT = "Boundary post for notifications";
    private static final String REPLY_CONTENT = "A reply on the boundary post.";

    @Test
    void firstPageReturnsNewestTwoItemsWithGlobalCursorStateAndPrivateCache() throws Exception {
        Account bob = newAccount();
        Account alice = newAccount();
        Post post = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        Reply reply = replyRepository.insertOwned(post.id(), alice.id(), REPLY_CONTENT);

        long replyId = notify(bob.id(), alice.id(), post.id(), reply.id(), NotificationType.REPLY);
        long likeId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long repostId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.REPOST);
        assertThat(replyId).isLessThan(likeId).isLessThan(repostId);

        MvcResult result = getNotifications(principal(bob), "2", null)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(repostId))
                .andExpect(jsonPath("$.items[0].type").value("REPOST"))
                .andExpect(jsonPath("$.items[0].actor").value(alice.displayName()))
                .andExpect(jsonPath("$.items[0].actorHandle").value(alice.handle()))
                .andExpect(jsonPath("$.items[0].postId").value(post.id()))
                .andExpect(jsonPath("$.items[0].postContent").value(POST_CONTENT))
                .andExpect(jsonPath("$.items[0].replyId").value(nullValue()))
                .andExpect(jsonPath("$.items[0].replyContent").value(nullValue()))
                .andExpect(jsonPath("$.items[0].createdAt").isString())
                .andExpect(jsonPath("$.items[0].createdAt").isNotEmpty())
                .andExpect(jsonPath("$.items[0].read").value(false))
                .andExpect(jsonPath("$.items[1].id").value(likeId))
                .andExpect(jsonPath("$.items[1].type").value("LIKE"))
                .andExpect(jsonPath("$.items[1].actor").value(alice.displayName()))
                .andExpect(jsonPath("$.items[1].actorHandle").value(alice.handle()))
                .andExpect(jsonPath("$.items[1].postId").value(post.id()))
                .andExpect(jsonPath("$.items[1].postContent").value(POST_CONTENT))
                .andExpect(jsonPath("$.items[1].replyId").value(nullValue()))
                .andExpect(jsonPath("$.items[1].replyContent").value(nullValue()))
                .andExpect(jsonPath("$.items[1].createdAt").isString())
                .andExpect(jsonPath("$.items[1].read").value(false))
                .andExpect(jsonPath("$.nextCursor").value(cursor(likeId)))
                .andExpect(jsonPath("$.latestCursor").value(cursor(repostId)))
                .andExpect(jsonPath("$.readThroughCursor").value(nullValue()))
                .andExpect(jsonPath("$.unreadCount").value(3))
                .andReturn();

        JsonNode page = objectMapper.readTree(result.getResponse().getContentAsString());
        assertCamelCaseOnly(page);
        Iterable<JsonNode> items = page.path("items");
        for (JsonNode item : items) {
            assertThat(camelCase(item)).isTrue();
        }
    }

    @Test
    void nextPageUsingBeforeCursorReturnsOnlyRemainingItemWhileGlobalsPersist() throws Exception {
        Account bob = newAccount();
        Account alice = newAccount();
        Post post = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        Reply reply = replyRepository.insertOwned(post.id(), alice.id(), REPLY_CONTENT);

        long replyId = notify(bob.id(), alice.id(), post.id(), reply.id(), NotificationType.REPLY);
        long likeId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long repostId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.REPOST);

        MvcResult result = getNotifications(principal(bob), "2", cursor(likeId))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(replyId))
                .andExpect(jsonPath("$.items[0].type").value("REPLY"))
                .andExpect(jsonPath("$.items[0].actor").value(alice.displayName()))
                .andExpect(jsonPath("$.items[0].actorHandle").value(alice.handle()))
                .andExpect(jsonPath("$.items[0].postId").value(post.id()))
                .andExpect(jsonPath("$.items[0].postContent").value(POST_CONTENT))
                .andExpect(jsonPath("$.items[0].replyId").value(reply.id()))
                .andExpect(jsonPath("$.items[0].replyContent").value(REPLY_CONTENT))
                .andExpect(jsonPath("$.items[0].createdAt").isString())
                .andExpect(jsonPath("$.items[0].read").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.latestCursor").value(cursor(repostId)))
                .andExpect(jsonPath("$.readThroughCursor").value(nullValue()))
                .andExpect(jsonPath("$.unreadCount").value(3))
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(body.path("items").path(0).path("id").asLong()).isEqualTo(replyId);
    }

    @Test
    void otherAccountCursorIsAcceptedOnlyAsAnIdBoundaryAndNeverLeaksItsItem() throws Exception {
        Account bob = newAccount();
        Account carol = newAccount();
        Account alice = newAccount();
        Post bobPost = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        Post carolPost = postRepository.insertOwned(carol.id(), "Carol's private post", "home");
        Reply reply = replyRepository.insertOwned(bobPost.id(), alice.id(), REPLY_CONTENT);

        long bobReplyId = notify(
                bob.id(), alice.id(), bobPost.id(), reply.id(), NotificationType.REPLY);
        long carolId = notify(carol.id(), alice.id(), carolPost.id(), null, NotificationType.LIKE);
        long bobLikeId = notify(bob.id(), alice.id(), bobPost.id(), null, NotificationType.LIKE);
        assertThat(bobReplyId).isLessThan(carolId).isLessThan(bobLikeId);

        MvcResult result = getNotifications(principal(bob), "10", cursor(carolId))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(bobReplyId))
                .andExpect(jsonPath("$.items[0].type").value("REPLY"))
                .andReturn();

        JsonNode items = objectMapper
                .readTree(result.getResponse().getContentAsString())
                .path("items");
        for (JsonNode item : items) {
            assertThat(item.path("id").asLong())
                    .as("paging cursor must never leak another account's notification")
                    .isNotEqualTo(carolId);
        }
    }

    @Test
    void markAllReadWithLatestCursorReturnsHighWaterAndSubsequentGetMarksAllRead()
            throws Exception {
        Account bob = newAccount();
        Account alice = newAccount();
        Post post = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        long likeId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long repostId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.REPOST);
        String latest = cursor(repostId);

        mockMvc.perform(put("/api/notifications/read")
                        .with(user(principal(bob)))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"through\": \"%s\"}", latest)))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.readThroughCursor").value(latest))
                .andExpect(jsonPath("$.unreadCount").value(0));

        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isEqualTo(repostId);

        MvcResult after = getNotifications(principal(bob), "10", null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(repostId))
                .andExpect(jsonPath("$.items[0].read").value(true))
                .andExpect(jsonPath("$.items[1].id").value(likeId))
                .andExpect(jsonPath("$.items[1].read").value(true))
                .andExpect(jsonPath("$.readThroughCursor").value(latest))
                .andExpect(jsonPath("$.latestCursor").value(latest))
                .andExpect(jsonPath("$.unreadCount").value(0))
                .andReturn();

        JsonNode pageBody = objectMapper.readTree(after.getResponse().getContentAsString());
        assertCamelCaseOnly(pageBody);
        for (JsonNode item : pageBody.path("items")) {
            assertThat(camelCase(item)).isTrue();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101", "abc"})
    void invalidLimitReturnsInvalidLimitProblemDetails(String limit) throws Exception {
        getNotifications(principal(newAccount()), limit, null)
                .andExpect(problemDetails(
                        400, "invalid-limit", "Invalid limit",
                        "INVALID_LIMIT", "/api/notifications"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"invalid", "MToz==", ""})
    void malformedPaddedOrBlankGetCursorReturnsInvalidCursor(String before) throws Exception {
        getNotifications(principal(newAccount()), "10", before)
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", "/api/notifications"));
    }

    @Test
    void rejectedReadBodiesReturnErrorsAndLeaveBothAccountsReadStateZero() throws Exception {
        Account bob = newAccount();
        Account carol = newAccount();
        Account alice = newAccount();
        Post bobPost = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        Post carolPost = postRepository.insertOwned(carol.id(), "Carol's post", "home");
        long carolId = notify(carol.id(), alice.id(), carolPost.id(), null, NotificationType.REPOST);
        notify(bob.id(), alice.id(), bobPost.id(), null, NotificationType.LIKE);
        String unknown = cursor(Long.MAX_VALUE);

        readAs(bob, "{}")
                .andExpect(problemDetails(
                        400, "validation-failed", "Validation failed",
                        "VALIDATION_FAILED", "/api/notifications/read"));
        readAs(bob, "{\"through\": \"   \"}")
                .andExpect(problemDetails(
                        400, "validation-failed", "Validation failed",
                        "VALIDATION_FAILED", "/api/notifications/read"));
        readAs(bob, "{invalid")
                .andExpect(problemDetails(
                        400, "malformed-request", "Malformed request",
                        "MALFORMED_REQUEST", "/api/notifications/read"));
        readAs(bob, "{\"through\": \"not-a-cursor\"}")
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", "/api/notifications/read"));
        readAs(bob, String.format("{\"through\": \"%s\"}", unknown))
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", "/api/notifications/read"));
        readAs(bob, String.format("{\"through\": \"%s\"}", cursor(carolId)))
                .andExpect(problemDetails(
                        400, "invalid-cursor", "Invalid cursor",
                        "INVALID_CURSOR", "/api/notifications/read"));

        assertThat(notificationReadRepository.findReadThroughId(bob.id()))
                .as("rejected read must not move Bob's read-through")
                .isZero();
        assertThat(notificationReadRepository.findReadThroughId(carol.id()))
                .as("other-account read must not move Carol's read-through")
                .isZero();
    }

    @Test
    void anonymousNotificationsRequireAuthenticationBeforePublicGetMatches()
            throws Exception {
        mockMvc.perform(get("/api/notifications"))
                .andExpect(problemDetails(
                        401, "authentication-required", "Authentication required",
                        "AUTHENTICATION_REQUIRED", "/api/notifications"));

        mockMvc.perform(put("/api/notifications/read")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"through\": \"MToz\"}"))
                .andExpect(problemDetails(
                        401, "authentication-required", "Authentication required",
                        "AUTHENTICATION_REQUIRED", "/api/notifications/read"));
    }

    @Test
    void authenticatedReadWithoutValidCsrfIsForbiddenAndLeavesReadStateUnchanged()
            throws Exception {
        Account bob = newAccount();
        Account alice = newAccount();
        Post post = postRepository.insertOwned(bob.id(), POST_CONTENT, "home");
        long latestId = notify(bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        String latest = cursor(latestId);

        mockMvc.perform(put("/api/notifications/read")
                        .with(user(principal(bob)))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"through\": \"%s\"}", latest)))
                .andExpect(problemDetails(
                        403, "csrf-token-invalid", "CSRF token invalid",
                        "CSRF_TOKEN_INVALID", "/api/notifications/read"));

        mockMvc.perform(put("/api/notifications/read")
                        .with(user(principal(bob)))
                        .with(csrf().useInvalidToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"through\": \"%s\"}", latest)))
                .andExpect(problemDetails(
                        403, "csrf-token-invalid", "CSRF token invalid",
                        "CSRF_TOKEN_INVALID", "/api/notifications/read"));

        assertThat(notificationReadRepository.findReadThroughId(bob.id()))
                .as("CSRF-rejected read must not advance Bob's read state")
                .isZero();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private Account newAccount() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String handle = "ntf" + suffix;
        return accountRepository.insert(handle, "Notification " + suffix, "unused-hash");
    }

    private static AccountPrincipal principal(Account account) {
        return new AccountPrincipal(account.id(), account.handle(), null);
    }

    private long notify(
            long recipientId, long actorId, long postId, Long replyId, NotificationType type) {
        return notificationRepository.insertAndPrune(recipientId, actorId, postId, replyId, type);
    }

    private String cursor(long id) {
        return cursorCodec.encode(new NotificationCursor(id));
    }

    private ResultActions getNotifications(
            AccountPrincipal principal, String limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/notifications");
        if (principal != null) {
            request.with(user(principal));
        }
        if (limit != null) {
            request.param("limit", limit);
        }
        if (before != null) {
            request.param("before", before);
        }
        return mockMvc.perform(request);
    }

    private ResultActions readAs(Account account, String body) throws Exception {
        return mockMvc.perform(put("/api/notifications/read")
                .with(user(principal(account)))
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    }

    private static ResultMatcher problemDetails(
            int expectedStatus,
            String typeSuffix,
            String title,
            String code,
            String instance) {
        return result -> {
            status().is(expectedStatus).match(result);
            content().contentTypeCompatibleWith(PROBLEM_JSON).match(result);
            jsonPath("$.type").value("urn:phark:problem:" + typeSuffix).match(result);
            jsonPath("$.title").value(title).match(result);
            jsonPath("$.status").value(expectedStatus).match(result);
            jsonPath("$.instance").value(instance).match(result);
            jsonPath("$.code").value(code).match(result);
        };
    }

    private static boolean camelCase(JsonNode node) {
        Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            if (field.getKey().contains("_")) {
                return false;
            }
            if (field.getValue().isObject() && !camelCase(field.getValue())) {
                return false;
            }
        }
        return true;
    }

    private static void assertCamelCaseOnly(JsonNode root) {
        Iterator<Map.Entry<String, JsonNode>> fields = root.fields();
        while (fields.hasNext()) {
            Map.Entry<String, JsonNode> field = fields.next();
            assertThat(field.getKey())
                    .as("field %s must be camelCase only", field.getKey())
                    .doesNotContain("_");
        }
    }
}
