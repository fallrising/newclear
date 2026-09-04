package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
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
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
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
class ReplyControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private JdbcClient jdbcClient;

    private AccountPrincipal principal;

    @BeforeEach
    void setUpAccount() {
        Account account = accountRepository.insert("replytester", "Tester", "unused-hash");
        principal = new AccountPrincipal(account.id(), account.handle(), null);
    }

    @Test
    void emptyConversationReturnsPageSchema() throws Exception {
        Post parent = createParent();

        mockMvc.perform(get(repliesUrl(parent.id())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items", hasSize(0)))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void createReplyReturnsCreatedAndIncrementsTimelineCount() throws Exception {
        Post parent = createParent();
        String body = """
                {
                  "content": "  First reply  "
                }
                """;

        mockMvc.perform(post(repliesUrl(parent.id()))
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.postId").value(parent.id()))
                .andExpect(jsonPath("$.author").value("Tester"))
                .andExpect(jsonPath("$.authorHandle").value("replytester"))
                .andExpect(jsonPath("$.content").value("First reply"));

        assertThat(postRepository.findById(parent.id()).orElseThrow().replyCount()).isEqualTo(1);
        String timelineResponse = mockMvc.perform(
                        get("/api/posts").param("channel", "home").param("limit", "100"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        JsonNode timeline = objectMapper.readTree(timelineResponse);
        JsonNode parentItem = findItem(timeline, parent.id());
        assertThat(parentItem.path("replyCount").asLong()).isEqualTo(1);
    }

    @Test
    void repliesPageForwardWithoutDuplicatesAtEqualTimestamps() throws Exception {
        Post parent = createParent();
        Reply first = insertAt(parent.id(), "First", "9999-12-31 23:59:59");
        Reply second = insertAt(parent.id(), "Second", "9999-12-31 23:59:59");
        Reply third = insertAt(parent.id(), "Third", "9999-12-31 23:59:59");

        JsonNode firstPage = getPage(parent.id(), 2, null);
        JsonNode secondPage = getPage(
                parent.id(), 2, firstPage.path("nextCursor").asText());

        assertThat(itemIds(firstPage)).containsExactly(first.id(), second.id());
        assertThat(firstPage.path("nextCursor").asText()).isNotBlank();
        assertThat(itemIds(secondPage)).containsExactly(third.id());
        assertThat(secondPage.path("nextCursor").isNull()).isTrue();
    }

    @Test
    void missingParentReturnsNotFoundForGetAndPost() throws Exception {
        long missingId = Long.MAX_VALUE;

        mockMvc.perform(get(repliesUrl(missingId)))
                .andExpect(status().isNotFound());
        mockMvc.perform(post(repliesUrl(missingId))
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isNotFound());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "-1"})
    void invalidPostIdReturnsBadRequest(String postId) throws Exception {
        mockMvc.perform(get("/api/posts/" + postId + "/replies"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/posts/" + postId + "/replies")
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101", "not-a-number"})
    void invalidLimitReturnsBadRequest(String limit) throws Exception {
        Post parent = createParent();

        mockMvc.perform(get(repliesUrl(parent.id())).param("limit", limit))
                .andExpect(status().isBadRequest());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "not*base64", "MTow", "MTox="})
    void invalidCursorReturnsBadRequest(String cursor) throws Exception {
        Post parent = createParent();

        mockMvc.perform(get(repliesUrl(parent.id())).param("after", cursor))
                .andExpect(status().isBadRequest());
    }

    @Test
    void invalidBodyReturnsBadRequest() throws Exception {
        Post parent = createParent();
        String body = """
                {
                  "content": "   "
                }
                """;

        mockMvc.perform(post(repliesUrl(parent.id()))
                        .with(user(principal))
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }

    private JsonNode getPage(long postId, int limit, String after) throws Exception {
        MockHttpServletRequestBuilder request = get(repliesUrl(postId))
                .param("limit", Integer.toString(limit));
        if (after != null) {
            request.param("after", after);
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

    private JsonNode findItem(JsonNode page, long id) {
        for (JsonNode item : page.path("items")) {
            if (item.path("id").asLong() == id) {
                return item;
            }
        }
        throw new AssertionError("Expected item " + id + " in page");
    }

    private Post createParent() {
        return postRepository.insert("Tester", "Parent post", "home");
    }

    private Reply insertAt(long postId, String content, String createdAt) {
        Reply reply = replyRepository.insert(postId, "Tester", content);
        jdbcClient
                .sql("UPDATE replies SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(reply.id())
                .update();
        return replyRepository.findById(reply.id()).orElseThrow();
    }

    private String repliesUrl(long postId) {
        return "/api/posts/" + postId + "/replies";
    }

    private String validBody() {
        return """
                {
                  "content": "Valid reply"
                }
                """;
    }
}
