package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class PostRepostReadContractTest {

    private static final String SAME_SECOND = "9999-12-31 23:59:59";
    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

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

    @Test
    void mixedSameSecondSortingPagesExactlyOnceAndLegacyBoundaryIsPostTuple() throws Exception {
        Account authorA = newAccount();
        Account authorB = newAccount();
        Account reposterA = newAccount();
        Account reposterB = newAccount();

        Post originalOne = postRepository.insertOwned(authorA.id(), "same-second original one", "home");
        Post originalTwo = postRepository.insertOwned(authorB.id(), "same-second original two", "home");
        setPostsAt(SAME_SECOND, originalOne.id(), originalTwo.id());

        postRepostRepository.repost(originalOne.id(), reposterA.id());
        postRepostRepository.repost(originalTwo.id(), reposterB.id());
        long relationA = relationId(reposterA.id(), originalOne.id());
        long relationB = relationId(reposterB.id(), originalTwo.id());
        setRepostsAt(SAME_SECOND, relationA, relationB);

        List<Long> postIdsDesc = List.of(originalOne.id(), originalTwo.id()).stream()
                .sorted((x, y) -> Long.compare(y, x))
                .collect(Collectors.toList());
        List<Long> relationIdsDesc = List.of(relationA, relationB).stream()
                .sorted((x, y) -> Long.compare(y, x))
                .collect(Collectors.toList());

        JsonNode firstPage = getTimelineAs(null, "home", 2, null);
        JsonNode secondPage = getTimelineAs(
                null, "home", 2, firstPage.path("nextCursor").asText(null));

        JsonNode firstItem = firstPage.path("items").get(0);
        assertTimelineEntry(firstItem, "post:" + postIdsDesc.get(0), postIdsDesc.get(0));
        assertTimelineEntry(
                firstPage.path("items").get(1),
                "post:" + postIdsDesc.get(1),
                postIdsDesc.get(1));
        assertTimelineEntry(
                secondPage.path("items").get(0),
                "repost:" + relationIdsDesc.get(0),
                originalPostForRepost(
                        relationIdsDesc.get(0),
                        relationA,
                        relationB,
                        originalOne,
                        originalTwo));
        assertTimelineEntry(
                secondPage.path("items").get(1),
                "repost:" + relationIdsDesc.get(1),
                originalPostForRepost(
                        relationIdsDesc.get(1),
                        relationA,
                        relationB,
                        originalOne,
                        originalTwo));

        List<String> allEntryIds = timelineEntryIds(firstPage, secondPage);
        assertThat(allEntryIds).containsExactlyInAnyOrder(
                "post:" + postIdsDesc.get(0),
                "post:" + postIdsDesc.get(1),
                "repost:" + relationIdsDesc.get(0),
                "repost:" + relationIdsDesc.get(1));
        assertThat(new HashSet<>(allEntryIds)).hasSize(4);
        assertThat(firstPage.path("nextCursor").isTextual())
                .as("first page remains cursor-paged")
                .isTrue();
        assertThat(secondPage.path("items")).hasSize(2);

        long epoch = LocalDateTime.parse(SAME_SECOND, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC)
                .getEpochSecond();
        String legacyBoundary = legacyCursor(epoch, postIdsDesc.get(0));
        JsonNode legacyPage = getTimelineAs(null, "home", 3, legacyBoundary);
        assertThat(timelineEntryIds(legacyPage))
                .as("legacy cursor applies the same tuple boundary as a v2 POST cursor")
                .containsExactly(
                        "post:" + postIdsDesc.get(1),
                        "repost:" + relationIdsDesc.get(0),
                        "repost:" + relationIdsDesc.get(1));
    }

    @Test
    void repostInheritsOriginalAndExposesAttributionAndStaysOutOfWrongChannel() throws Exception {
        Account originalAuthor = newAccount();
        Account reposter = newAccount();

        Post original =
                postRepository.insertOwned(originalAuthor.id(), "tech original content", "tech");
        setPostsAt(SAME_SECOND, original.id());
        postRepostRepository.repost(original.id(), reposter.id());
        long repostId = relationId(reposter.id(), original.id());
        setRepostsAt(SAME_SECOND, repostId);

        String repostKey = "repost:" + repostId;
        String originalKey = "post:" + original.id();

        JsonNode techPage = getTimelineAs(null, "tech", 100, null);
        JsonNode repostCopy = findPostByTimelineEntry(techPage, repostKey);
        JsonNode originalCopy = findPostByTimelineEntry(techPage, originalKey);

        assertThat(repostCopy.path("id").asLong()).isEqualTo(original.id());
        assertThat(repostCopy.path("author").asText()).isEqualTo(originalAuthor.displayName());
        assertThat(repostCopy.path("authorHandle").asText()).isEqualTo(originalAuthor.handle());
        assertThat(repostCopy.path("content").asText()).isEqualTo("tech original content");
        assertThat(repostCopy.path("channel").asText()).isEqualTo("tech");
        String expectedOriginalCreatedAt = LocalDateTime.parse(SAME_SECOND, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC)
                .toString();
        assertThat(repostCopy.path("createdAt").asText()).isEqualTo(expectedOriginalCreatedAt);
        assertThat(repostCopy.path("repostedBy").asText()).isEqualTo(reposter.displayName());
        assertThat(repostCopy.path("repostedByHandle").asText()).isEqualTo(reposter.handle());
        assertThat(repostCopy.path("repostedAt").isTextual())
                .as("repost activity exposes a repostedAt timestamp")
                .isTrue();
        assertThat(repostCopy.path("repostCount").asLong()).isEqualTo(1);

        assertThat(originalCopy.path("timelineEntryId").asText()).isEqualTo(originalKey);
        assertThat(originalCopy.path("id").asLong()).isEqualTo(original.id());
        assertThat(originalCopy.path("repostedBy").isNull()).isTrue();
        assertThat(originalCopy.path("repostedByHandle").isNull()).isTrue();
        assertThat(originalCopy.path("repostedAt").isNull()).isTrue();

        Set<String> homeContents = new HashSet<>();
        JsonNode homePage = getTimelineAs(null, "home", 100, null);
        homePage.path("items").forEach(item -> homeContents.add(item.path("content").asText()));
        assertThat(homeContents)
                .as("repost of tech content must not leak into the home channel")
                .doesNotContain("tech original content");
    }

    @Test
    void profileFeedIncludesOwnActivitiesAndExcludesOthersRepostOfOwnPost() throws Exception {
        Account owner = newAccount();
        Account other = newAccount();

        Post owned =
                postRepository.insertOwned(owner.id(), "owner profile original", "home");
        Post otherOriginal =
                postRepository.insertOwned(other.id(), "other post owner will repost", "home");
        setPostsAt(SAME_SECOND, owned.id(), otherOriginal.id());

        postRepostRepository.repost(owned.id(), other.id());
        long othersRepostOfOwned = relationId(other.id(), owned.id());
        postRepostRepository.repost(otherOriginal.id(), owner.id());
        long ownersRepost = relationId(owner.id(), otherOriginal.id());
        setRepostsAt(SAME_SECOND, ownersRepost, othersRepostOfOwned);

        Set<String> profileKeys = new HashSet<>();
        JsonNode profilePage = getProfilePostsAs(owner.handle(), null, 100, null);
        profilePage.path("items")
                .forEach(item -> profileKeys.add(item.path("timelineEntryId").asText()));

        assertThat(profileKeys)
                .as("owner profile includes owner's original activity")
                .contains("post:" + owned.id());
        assertThat(profileKeys)
                .as("owner profile includes owner's own repost activity")
                .contains("repost:" + ownersRepost);
        assertThat(profileKeys)
                .as("owner profile excludes another account's repost of the owner's post")
                .doesNotContain("repost:" + othersRepostOfOwned);
    }

    @Test
    void sharedCountsMatchAcrossCopiesAndViewerStateIsIsolatedWithPrivateCache() throws Exception {
        Account actor = newAccount();
        Account nonActor = newAccount();

        Post owned = postRepository.insertOwned(actor.id(), "shared counts read", "home");
        setPostsAt(SAME_SECOND, owned.id());
        postRepostRepository.repost(owned.id(), actor.id());
        long repostId = relationId(actor.id(), owned.id());
        setRepostsAt(SAME_SECOND, repostId);

        replyRepository.insertOwned(owned.id(), nonActor.id(), "a reply");
        postLikeRepository.like(owned.id(), nonActor.id());

        long expectedRepostCount = jdbcClient
                .sql("SELECT COUNT(*) FROM post_reposts WHERE post_id = ?")
                .param(owned.id())
                .query(Long.class)
                .single();

        JsonNode actorPage = getTimelineAs(actor, "home", 100, null);
        assertSharedCopies(actorPage, owned.id(), repostId, 1, 1, expectedRepostCount, true, "actor session");

        JsonNode nonActorPage = getTimelineAs(nonActor, "home", 100, null);
        assertSharedCopies(nonActorPage, owned.id(), repostId, 1, 1, expectedRepostCount, false, "non-actor session");

        JsonNode anonymousPage = getTimelineAs(null, "home", 100, null);
        assertSharedCopies(anonymousPage, owned.id(), repostId, 1, 1, expectedRepostCount, false, "anonymous session");

        mockMvc.perform(get("/api/posts").param("channel", "home")
                        .with(user(principal(actor))))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")));

        mockMvc.perform(get("/api/profiles/" + actor.handle() + "/posts")
                        .with(user(principal(actor))))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private Account newAccount() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String handle = ("prr" + suffix).substring(0, Math.min("prr".length() + suffix.length(), 15));
        return accountRepository.insert(handle, "Repost Reader " + suffix, "unused-hash");
    }

    private static AccountPrincipal principal(Account account) {
        return new AccountPrincipal(account.id(), account.handle(), null);
    }

    private void setPostsAt(String timestamp, long... postIds) {
        for (long postId : postIds) {
            jdbcClient
                    .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                    .param(timestamp)
                    .param(postId)
                    .update();
        }
    }

    private void setRepostsAt(String timestamp, long... repostIds) {
        for (long repostId : repostIds) {
            jdbcClient
                    .sql("UPDATE post_reposts SET created_at = ? WHERE id = ?")
                    .param(timestamp)
                    .param(repostId)
                    .update();
        }
    }

    private long relationId(long accountId, long postId) {
        return jdbcClient
                .sql("SELECT id FROM post_reposts WHERE account_id = ? AND post_id = ?")
                .param(accountId)
                .param(postId)
                .query(Long.class)
                .single();
    }

    private static String legacyCursor(long epochSecond, long postId) {
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString((epochSecond + ":" + postId).getBytes(StandardCharsets.UTF_8));
    }

    private JsonNode getTimelineAs(
            Account viewer, String channel, Integer limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/posts");
        if (channel != null) {
            request.param("channel", channel);
        }
        if (limit != null) {
            request.param("limit", Integer.toString(limit));
        }
        if (before != null) {
            request.param("before", before);
        }
        if (viewer != null) {
            request.with(user(principal(viewer)));
        }
        String body = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(body);
    }

    private JsonNode getProfilePostsAs(
            String handle, Account viewer, Integer limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/profiles/" + handle + "/posts");
        if (limit != null) {
            request.param("limit", Integer.toString(limit));
        }
        if (before != null) {
            request.param("before", before);
        }
        if (viewer != null) {
            request.with(user(principal(viewer)));
        }
        String body = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(body);
    }

    private static void assertTimelineEntry(
            JsonNode item, String expectedEntryId, long expectedPostId) {
        assertThat(item.path("timelineEntryId").asText())
                .as("activity entry identity")
                .isEqualTo(expectedEntryId);
        assertThat(item.path("id").asLong())
                .as("activity keeps the original post id")
                .isEqualTo(expectedPostId);
    }

    private static long originalPostForRepost(
            long relationId,
            long relationA,
            long relationB,
            Post originalOne,
            Post originalTwo) {
        return relationId == relationA ? originalOne.id() : originalTwo.id();
    }

    private static List<String> timelineEntryIds(JsonNode... pages) {
        List<String> ids = new java.util.ArrayList<>();
        for (JsonNode page : pages) {
            page.path("items").forEach(item -> ids.add(item.path("timelineEntryId").asText()));
        }
        return ids;
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

    private static void assertSharedCopies(
            JsonNode page,
            long originalId,
            long repostId,
            long expectedReplyCount,
            long expectedLikeCount,
            long expectedRepostCount,
            boolean repostedByViewer,
            String context) {
        JsonNode originalCopy = findPostByTimelineEntry(page, "post:" + originalId);
        JsonNode repostCopy = findPostByTimelineEntry(page, "repost:" + repostId);

        long originalReply = originalCopy.path("replyCount").asLong();
        long repostReply = repostCopy.path("replyCount").asLong();
        assertThat(originalReply)
                .as(context + " replyCount shared")
                .isEqualTo(expectedReplyCount);
        assertThat(repostReply)
                .as(context + " repost copy replyCount shared")
                .isEqualTo(expectedReplyCount);

        long originalLike = originalCopy.path("likeCount").asLong();
        long repostLike = repostCopy.path("likeCount").asLong();
        assertThat(originalLike).as(context + " likeCount shared").isEqualTo(expectedLikeCount);
        assertThat(repostLike)
                .as(context + " repost copy likeCount shared")
                .isEqualTo(expectedLikeCount);

        long originalRepost = originalCopy.path("repostCount").asLong();
        long repostRepost = repostCopy.path("repostCount").asLong();
        assertThat(originalRepost)
                .as(context + " repostCount shared")
                .isEqualTo(expectedRepostCount);
        assertThat(repostRepost)
                .as(context + " repost copy repostCount shared")
                .isEqualTo(expectedRepostCount);

        assertThat(originalCopy.path("repostedByViewer").asBoolean())
                .as(context + " original copy viewer state")
                .isEqualTo(repostedByViewer);
        assertThat(repostCopy.path("repostedByViewer").asBoolean())
                .as(context + " repost copy viewer state")
                .isEqualTo(repostedByViewer);
    }
}
