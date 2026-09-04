package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class SearchControllerTest {

    private static final String PROBLEM_JSON = "application/problem+json";

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
    private PostRepostRepository postRepostRepository;

    @Autowired
    private JdbcClient jdbcClient;

    // ── Success path and viewer-aware shape ─────────────────────────────────

    @Test
    void anonymousSearchThroughSecurityChainReturnsFullShapeWithFalseFlags() throws Exception {
        mockMvc.perform(get("/api/search").param("q", "standup"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$.items", hasSize(1)))
                .andExpect(jsonPath("$.items[0].id").isNumber())
                .andExpect(jsonPath("$.items[0].author").value("Bob"))
                .andExpect(jsonPath("$.items[0].authorHandle").value(nullValue()))
                .andExpect(jsonPath("$.items[0].content").value("Morning standup notes are posted here."))
                .andExpect(jsonPath("$.items[0].channel").value("home"))
                .andExpect(jsonPath("$.items[0].createdAt").isString())
                .andExpect(jsonPath("$.items[0].replyCount").isNumber())
                .andExpect(jsonPath("$.items[0].likeCount").isNumber())
                .andExpect(jsonPath("$.items[0].likedByViewer").value(false))
                .andExpect(jsonPath("$.items[0].timelineEntryId").isString())
                .andExpect(jsonPath("$.items[0].repostCount").isNumber())
                .andExpect(jsonPath("$.items[0].repostedByViewer").value(false))
                .andExpect(jsonPath("$.items[0].repostedBy").value(nullValue()))
                .andExpect(jsonPath("$.items[0].repostedByHandle").value(nullValue()))
                .andExpect(jsonPath("$.items[0].repostedAt").value(nullValue()))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void authenticatedViewerSeesFlagsWhileCountsStayShared() throws Exception {
        Account alice = accountRepository.insert("searchauthor", "Search Alice", "hash");
        Post post = insertOwnedAt(alice, "viewerflagphrase", "2026-09-03 09:00:02");
        Account viewer = accountRepository.insert("searchviewer", "Search Bob", "hash");
        postLikeRepository.like(post.id(), viewer.id());
        postRepostRepository.repost(post.id(), viewer.id());
        AccountPrincipal principal =
                new AccountPrincipal(viewer.id(), viewer.handle(), null);

        mockMvc.perform(get("/api/search").param("q", "viewerflagphrase"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].likedByViewer").value(false))
                .andExpect(jsonPath("$.items[0].repostedByViewer").value(false))
                .andExpect(jsonPath("$.items[0].likeCount").value(1))
                .andExpect(jsonPath("$.items[0].repostCount").value(1));

        mockMvc.perform(get("/api/search").param("q", "viewerflagphrase")
                        .with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].likedByViewer").value(true))
                .andExpect(jsonPath("$.items[0].repostedByViewer").value(true))
                .andExpect(jsonPath("$.items[0].likeCount").value(1))
                .andExpect(jsonPath("$.items[0].repostCount").value(1));
    }

    @Test
    void defaultLimitReturnsTwentyItemsWithCursor() throws Exception {
        for (int index = 0; index < 24; index++) {
            insertAt("limitword extra " + index, "2026-09-03 09:00:%02d".formatted(index));
        }

        mockMvc.perform(get("/api/search").param("q", "limitword"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$.items", hasSize(20)))
                .andExpect(jsonPath("$.nextCursor").isString());
    }

    @Test
    void explicitLimitReturnsBoundedPageWithCursor() throws Exception {
        for (int index = 0; index < 5; index++) {
            insertAt("explicitphrase " + index, "2026-09-03 09:00:%02d".formatted(index));
        }

        mockMvc.perform(get("/api/search").param("q", "explicitphrase").param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.nextCursor").isString());
    }

    // ── Deterministic pagination ───────────────────────────────────────────

    @Test
    void equalTimestampsRemainStableAcrossPages() throws Exception {
        Post first = insertAt("eqphrase", "9999-12-31 23:59:59");
        Post second = insertAt("eqphrase", "9999-12-31 23:59:59");
        Post third = insertAt("eqphrase", "9999-12-31 23:59:59");

        JsonNode firstPage = getPage("eqphrase", 2, null);
        JsonNode secondPage = getPage("eqphrase", 2, firstPage.path("nextCursor").asText());

        assertThat(firstPage.path("items").get(0).path("id").asLong()).isEqualTo(third.id());
        assertThat(firstPage.path("items").get(1).path("id").asLong()).isEqualTo(second.id());
        assertThat(secondPage.path("items").get(0).path("id").asLong()).isEqualTo(first.id());
        assertThat(itemIds(secondPage)).doesNotContainAnyElementsOf(itemIds(firstPage));
    }

    @Test
    void newerMatchingInsertBetweenPagesIsExcluded() throws Exception {
        Post oldest = insertAt("betweenphrase", "9999-12-31 23:59:57");
        Post middle = insertAt("betweenphrase", "9999-12-31 23:59:58");
        Post latest = insertAt("betweenphrase", "9999-12-31 23:59:59");

        JsonNode firstPage = getPage("betweenphrase", 2, null);
        Post newer = insertAt("betweenphrase", "9999-12-31 23:59:59");
        JsonNode secondPage = getPage("betweenphrase", 2, firstPage.path("nextCursor").asText());

        assertThat(itemIds(firstPage)).containsExactly(latest.id(), middle.id());
        assertThat(itemIds(secondPage)).containsExactly(oldest.id());
        assertThat(itemIds(secondPage))
                .doesNotContain(latest.id(), middle.id(), newer.id());
    }

    // ── Operator/wildcard shaped plain queries ─────────────────────────────

    @Test
    void operatorAndWildcardShapedQueriesNeverCreateMatchErrors() throws Exception {
        for (String query : List.of(
                "NOT", "OR", "AND", "NEAR", "alpha OR beta", "(x)",
                "col:values", "^tag", "foo^bar", "foo*", "*bar", "say\"hi\"now")) {
            mockMvc.perform(get("/api/search").param("q", query))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void fooStarDoesNotPrefixMatchFoobar() throws Exception {
        Post foo = insertAt("foo", "2026-09-03 09:00:02");
        Post foobar = insertAt("foobar", "2026-09-03 09:00:01");

        JsonNode page = getPage("foo*", 10, null);

        assertThat(itemIds(page)).containsExactly(foo.id());
        assertThat(itemIds(page)).doesNotContain(foobar.id());
    }

    // ── Error contract ─────────────────────────────────────────────────────

    @Test
    void missingQGoesThroughServiceValidation() throws Exception {
        mockMvc.perform(get("/api/search"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-query"))
                .andExpect(jsonPath("$.title").value("Invalid query"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.code").value("INVALID_QUERY"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail")
                        .value("Query must be 1 to 100 characters with at most 8 terms, "
                                + "each containing a letter or digit."));
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "***", "( )", "a b c d e f g h i", "a\u0001b"})
    void invalidQueriesReturnInvalidQueryProblemDetails(String q) throws Exception {
        mockMvc.perform(get("/api/search").param("q", q))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-query"))
                .andExpect(jsonPath("$.title").value("Invalid query"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.code").value("INVALID_QUERY"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void overLongQueryReturnsInvalidQueryProblemDetails() throws Exception {
        mockMvc.perform(get("/api/search").param("q", "a".repeat(101)))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_QUERY"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "51", "abc"})
    void invalidLimitsReturnInvalidLimitProblemDetails(String limit) throws Exception {
        mockMvc.perform(get("/api/search").param("q", "ship").param("limit", limit))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-limit"))
                .andExpect(jsonPath("$.title").value("Invalid limit"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.code").value("INVALID_LIMIT"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail").value("Limit must be between 1 and 50."));
    }

    @ParameterizedTest
    @ValueSource(strings = {"garbage", "not*base64", "MTow", ""})
    void malformedCursorsReturnInvalidCursorProblemDetails(String before) throws Exception {
        mockMvc.perform(get("/api/search").param("q", "ship").param("before", before))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-cursor"))
                .andExpect(jsonPath("$.title").value("Invalid cursor"))
                .andExpect(jsonPath("$.status").value(400))
                .andExpect(jsonPath("$.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "MToxNzIyMjQ5NjAwOjQy",
            "MjoxNzIyMjQ5NjAwOlBPU1Q6NDI",
            "MTo5MQ"
    })
    void crossNamespaceCursorsReturnInvalidCursorProblemDetails(String before) throws Exception {
        mockMvc.perform(get("/api/search").param("q", "ship").param("before", before))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_CURSOR"))
                .andExpect(jsonPath("$.instance").value("/api/search"))
                .andExpect(jsonPath("$.detail").isString());
    }

    @Test
    void invalidQueryEchoesRequestId() throws Exception {
        mockMvc.perform(get("/api/search").param("q", "   ")
                        .header("X-Request-ID", "search-contract-7"))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("X-Request-ID", "search-contract-7"))
                .andExpect(jsonPath("$.requestId").value("search-contract-7"));
    }

    private JsonNode getPage(String query, Integer limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/search").param("q", query);
        if (limit != null) {
            request.param("limit", Integer.toString(limit));
        }
        if (before != null) {
            request.param("before", before);
        }
        String response = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(response);
    }

    private List<Long> itemIds(JsonNode page) {
        List<Long> ids = new ArrayList<>();
        page.path("items").forEach(item -> ids.add(item.path("id").asLong()));
        return ids;
    }

    private Post insertAt(String content, String createdAt) {
        Post post = postRepository.insert("legacy author", content, "home");
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }

    private Post insertOwnedAt(Account account, String content, String createdAt) {
        Post post = postRepository.insertOwned(account.id(), content, "home");
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }
}
