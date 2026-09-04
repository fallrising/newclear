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
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
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
class PostLikeReadContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private PostLikeRepository postLikeRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void anonymousTimelineShowsAuthoritativeLikeCountAndPrivateNoStoreCache() throws Exception {
        Account author = newAccount();
        Account liker = newAccount();
        Post post = postRepository.insertOwned(author.id(), "anonymous liked read", "home");
        postLikeRepository.like(post.id(), liker.id());

        long expectedCount = jdbcClient
                .sql("SELECT COUNT(*) FROM post_likes WHERE post_id = ?")
                .param(post.id())
                .query(Long.class)
                .single();

        String body = mockMvc.perform(get("/api/posts").param("channel", "home"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode item = findPostByContent(objectMapper.readTree(body), "anonymous liked read");
        assertLikeFields(item, expectedCount, false, "anonymous timeline post");
    }

    @Test
    void likerAndNonLikerSessionsSeeIsolatedViewerStateWithSameCount() throws Exception {
        Account author = newAccount();
        Account liker = newAccount();
        Account nonLiker = newAccount();
        Post post = postRepository.insertOwned(author.id(), "viewer isolation read", "home");
        postLikeRepository.like(post.id(), liker.id());

        JsonNode likerPage = getTimelineAs(liker, "home", null, null);
        JsonNode likerItem = findPostByContent(likerPage, "viewer isolation read");
        assertLikeFields(likerItem, 1, true, "liker session");

        JsonNode nonLikerPage = getTimelineAs(nonLiker, "home", null, null);
        JsonNode nonLikerItem = findPostByContent(nonLikerPage, "viewer isolation read");
        assertThat(nonLikerItem.path("likeCount").asLong())
                .as("count is shared across viewers")
                .isEqualTo(likerItem.path("likeCount").asLong());
        assertLikeFields(nonLikerItem, 1, false, "non-liker session");

        JsonNode anonymousPage = getTimelineAs(null, "home", null, null);
        JsonNode anonymousItem = findPostByContent(anonymousPage, "viewer isolation read");
        assertLikeFields(anonymousItem, 1, false, "anonymous session");
    }

    @Test
    void profilePostsShowSameViewerBehaviorAndLegacyPostCanBeLiked() throws Exception {
        Account author = newAccount();
        Account liker = newAccount();
        Post owned = postRepository.insertOwned(author.id(), "profile liked read", "home");
        Post legacy = postRepository.insert("Legacy Author", "legacy likable read", "home");
        postLikeRepository.like(owned.id(), liker.id());
        postLikeRepository.like(legacy.id(), liker.id());

        String profileBody = mockMvc.perform(get("/api/profiles/" + author.handle() + "/posts")
                        .with(user(principal(liker))))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", containsString("private")))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode profilePage = objectMapper.readTree(profileBody);
        assertLikeFields(
                findPostByContent(profilePage, "profile liked read"), 1, true, "liker profile post");

        Set<String> profileContents = new HashSet<>();
        profilePage.path("items")
                .forEach(item -> profileContents.add(item.path("content").asText()));
        assertThat(profileContents)
                .as("profile page still only contains owned posts")
                .doesNotContain("legacy likable read");

        JsonNode anonymousProfile = getProfilePostsAs(author.handle(), null, null, null);
        assertLikeFields(
                findPostByContent(anonymousProfile, "profile liked read"),
                1,
                false,
                "anonymous profile post");

        JsonNode likerTimeline = getTimelineAs(liker, "home", null, null);
        assertLikeFields(
                findPostByContent(likerTimeline, "legacy likable read"), 1, true, "liker legacy post");

        JsonNode anonymousTimeline = getTimelineAs(null, "home", null, null);
        assertLikeFields(
                findPostByContent(anonymousTimeline, "legacy likable read"),
                1,
                false,
                "anonymous legacy post");
    }

    @Test
    void likeFieldsCoexistWithReplyCountAndPageOrdering() throws Exception {
        Account author = newAccount();
        Account liker = newAccount();
        Post older = postRepository.insertOwned(author.id(), "older order read", "home");
        Post newer = postRepository.insertOwned(author.id(), "newer order read", "home");
        replyRepository.insertOwned(newer.id(), author.id(), "a reply");
        postLikeRepository.like(newer.id(), liker.id());

        JsonNode page = getTimelineAs(null, "home", 2, null);
        assertThat(page.path("items")).hasSize(2);
        assertThat(page.path("items").get(0).path("id").asLong())
                .as("newest post stays first")
                .isEqualTo(newer.id());
        assertThat(page.path("items").get(1).path("id").asLong())
                .as("older post stays second")
                .isEqualTo(older.id());
        assertThat(page.path("nextCursor").isTextual())
                .as("cursor paging remains observable")
                .isTrue();

        JsonNode item = page.path("items").get(0);
        assertThat(item.path("replyCount").asLong())
                .as("replyCount remains observable")
                .isEqualTo(1);
        assertLikeFields(item, 1, false, "read post with reply");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private Account newAccount() {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String handle = ("plr" + suffix).substring(0, Math.min("plr".length() + suffix.length(), 15));
        return accountRepository.insert(handle, "Like Reader " + suffix, "unused-hash");
    }

    private static AccountPrincipal principal(Account account) {
        return new AccountPrincipal(account.id(), account.handle(), null);
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

    private static void assertLikeFields(
            JsonNode item, long expectedCount, boolean likedByViewer, String context) {
        assertThat(item.hasNonNull("likeCount"))
                .as(context + " exposes likeCount")
                .isTrue();
        assertThat(item.path("likeCount").asLong())
                .as(context + " likeCount is authoritative")
                .isEqualTo(expectedCount);
        assertThat(item.hasNonNull("likedByViewer"))
                .as(context + " exposes likedByViewer")
                .isTrue();
        assertThat(item.path("likedByViewer").asBoolean())
                .as(context + " likedByViewer")
                .isEqualTo(likedByViewer);
    }

    private static JsonNode findPostByContent(JsonNode page, String content) {
        for (JsonNode item : page.path("items")) {
            if (content.equals(item.path("content").asText())) {
                return item;
            }
        }
        throw new AssertionError("Expected post with content '" + content + "' in page");
    }
}
