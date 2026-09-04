package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
class PostControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private JdbcClient jdbcClient;

    private AccountPrincipal principal;

    @BeforeEach
    void setUpAccount() {
        Account account = accountRepository.insert("posttester", "Tester", "unused-hash");
        principal = new AccountPrincipal(account.id(), account.handle(), null);
    }

    @Test
    void getPostsReturnsPageSchema() throws Exception {
        mockMvc.perform(get("/api/posts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(greaterThanOrEqualTo(9))))
                .andExpect(jsonPath("$.items[0].replyCount").isNumber())
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void getPostsUsesDefaultLimit() throws Exception {
        for (int index = 0; index < 12; index++) {
            postRepository.insert("Tester", "Extra post " + index, "home");
        }

        mockMvc.perform(get("/api/posts"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(20)))
                .andExpect(jsonPath("$.nextCursor").isString());
    }

    @Test
    void getPostsByChannelFiltersResults() throws Exception {
        mockMvc.perform(get("/api/posts").param("channel", "tech"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(3)))
                .andExpect(jsonPath("$.items[0].channel").value("tech"))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void getPostsWithLimitReturnsBoundedPage() throws Exception {
        mockMvc.perform(get("/api/posts").param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.nextCursor").isString());
    }

    @Test
    void getPostsWithInvalidChannelReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/posts").param("channel", "news"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(get("/api/posts").param("channel", ""))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101", "not-a-number"})
    void getPostsWithInvalidLimitReturnsBadRequest(String limit) throws Exception {
        mockMvc.perform(get("/api/posts").param("limit", limit))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not*base64", "MTow", "MTox="})
    void getPostsWithInvalidCursorReturnsBadRequest(String cursor) throws Exception {
        mockMvc.perform(get("/api/posts").param("before", cursor))
                .andExpect(status().isBadRequest());
    }

    @Test
    void pagesDoNotDuplicateWhenANewerPostIsInserted() throws Exception {
        Post oldest = insertAt("Oldest post", "home", "9999-12-31 23:59:57");
        Post middle = insertAt("Middle post", "home", "9999-12-31 23:59:58");
        Post latest = insertAt("Latest post", "home", "9999-12-31 23:59:59");

        JsonNode firstPage = getPage("home", 2, null);
        Post newlyInserted = insertAt("New post", "home", "9999-12-31 23:59:59");
        JsonNode secondPage = getPage("home", 2, firstPage.path("nextCursor").asText());

        assertThat(itemIds(firstPage)).containsExactlyInAnyOrder(latest.id(), middle.id());
        assertThat(secondPage.path("items").get(0).path("id").asLong()).isEqualTo(oldest.id());
        assertThat(itemIds(secondPage))
                .doesNotContainAnyElementsOf(itemIds(firstPage))
                .doesNotContain(newlyInserted.id());
    }

    @Test
    void equalTimestampsRemainStableAcrossPages() throws Exception {
        Post first = insertAt("First post", "home", "9999-12-31 23:59:59");
        Post second = insertAt("Second post", "home", "9999-12-31 23:59:59");
        Post third = insertAt("Third post", "home", "9999-12-31 23:59:59");

        JsonNode firstPage = getPage("home", 2, null);
        JsonNode secondPage = getPage("home", 2, firstPage.path("nextCursor").asText());

        assertThat(firstPage.path("items").get(0).path("id").asLong()).isEqualTo(third.id());
        assertThat(firstPage.path("items").get(1).path("id").asLong()).isEqualTo(second.id());
        assertThat(secondPage.path("items").get(0).path("id").asLong()).isEqualTo(first.id());
        assertThat(itemIds(secondPage)).doesNotContainAnyElementsOf(itemIds(firstPage));
    }

    @Test
    void channelPaginationNeverReturnsAnotherChannel() throws Exception {
        insertAt("Newest home post", "home", "9999-12-31 23:59:59");
        insertAt("Newest tech post", "tech", "9999-12-31 23:59:59");

        JsonNode page = getPage("tech", 100, null);

        page.path("items").forEach(item ->
                assertThat(item.path("channel").asText()).isEqualTo("tech"));
    }

    @Test
    void createPostReturnsCreatedPost() throws Exception {
        String body = """
                {
                  "content": "Hello from tests",
                  "channel": "home"
                }
                """;

        mockMvc.perform(post("/api/posts")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value("Tester"))
                .andExpect(jsonPath("$.content").value("Hello from tests"))
                .andExpect(jsonPath("$.channel").value("home"))
                .andExpect(jsonPath("$.replyCount").value(0));
    }

    @Test
    void createPostWithInvalidChannelReturnsBadRequest() throws Exception {
        String body = """
                {
                  "content": "Invalid channel",
                  "channel": "news"
                }
                """;

        mockMvc.perform(post("/api/posts")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createPostWithBlankContentReturnsBadRequest() throws Exception {
        String body = """
                {
                  "content": "   ",
                  "channel": "home"
                }
                """;

        mockMvc.perform(post("/api/posts")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    @Test
    void createPostWithLongContentReturnsBadRequest() throws Exception {
        String body = """
                {
                  "content": "%s",
                  "channel": "home"
                }
                """.formatted("A".repeat(501));

        mockMvc.perform(post("/api/posts")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    private JsonNode getPage(String channel, int limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/posts")
                .param("limit", Integer.toString(limit));
        if (channel != null) {
            request.param("channel", channel);
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

    private Set<Long> itemIds(JsonNode page) {
        Set<Long> ids = new HashSet<>();
        page.path("items").forEach(item -> ids.add(item.path("id").asLong()));
        return ids;
    }

    private Post insertAt(String content, String channel, String createdAt) {
        Post post = postRepository.insert("Tester", content, channel);
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }
}
