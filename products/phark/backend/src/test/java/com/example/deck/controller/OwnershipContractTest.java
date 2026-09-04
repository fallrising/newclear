package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class OwnershipContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private JdbcClient jdbcClient;

    private static final String PROBLEM_JSON = "application/problem+json";

    private record CsrfToken(String headerName, String token) {}

    private CsrfToken fetchCsrf(MockHttpSession session) throws Exception {
        var builder = get("/api/auth/csrf");
        if (session != null) {
            builder.session(session);
        }
        MvcResult result = mockMvc.perform(builder)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(header().string("Cache-Control", containsString("no-store")))
                .andReturn();
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        return new CsrfToken(body.get("headerName").asText(), body.get("token").asText());
    }

    private static String uniqueSuffix() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    }

    private static String canonicalHandle() {
        String suffix = uniqueSuffix();
        String handle = "own" + suffix;
        return handle.substring(0, Math.min(handle.length(), 15));
    }

    private static String regBody(String handle, String displayName, String password) {
        return """
                {"handle":"%s","displayName":"%s","password":"%s"}
                """.formatted(handle, displayName, password);
    }

    private static String loginBody(String handle, String password) {
        return """
                {"handle":"%s","password":"%s"}
                """.formatted(handle, password);
    }

    private record AuthSession(MockHttpSession session, CsrfToken csrf, long accountId,
                               String handle, String displayName) {}

    private AuthSession registerAndLogin() throws Exception {
        String handle = canonicalHandle();
        String displayName = "Owner Test";
        String password = "password-12345678";

        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, displayName, password)))
                .andExpect(status().isCreated());

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, password)))
                .andExpect(status().isOk())
                .andReturn();

        MockHttpSession postLoginSession = (MockHttpSession) loginResult.getRequest().getSession();
        CsrfToken freshCsrf = fetchCsrf(postLoginSession);

        long accountId = jdbcClient
                .sql("SELECT id FROM accounts WHERE handle = ?")
                .param(handle)
                .query(Long.class)
                .single();

        return new AuthSession(postLoginSession, freshCsrf, accountId, handle, displayName);
    }

    // ── Anonymous: AUTHENTICATION_REQUIRED ──────────────────────────────────

    @Test
    void anonymousPostCreationReturnsAuthRequiredAndNoRowChange() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        long before = postRepository.count();

        mockMvc.perform(post("/api/posts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"must not persist","channel":"home"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        assertThat(postRepository.count()).isEqualTo(before);
    }

    @Test
    void anonymousReplyCreationReturnsAuthRequiredAndNoRowChange() throws Exception {
        Post parent = postRepository.insert("Tester", "Parent for anonymous reply test", "home");

        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        long before = jdbcClient.sql("SELECT COUNT(*) FROM replies").query(Long.class).single();

        mockMvc.perform(post("/api/posts/" + parent.id() + "/replies")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"must not persist"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM replies").query(Long.class).single())
                .isEqualTo(before);
    }

    // ── Authenticated post creation ─────────────────────────────────────────

    @Test
    void authenticatedPostCreatesOwnershipAndReturnsHandle() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(post("/api/posts")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"ownership post","channel":"home"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value(auth.displayName()))
                .andExpect(jsonPath("$.authorHandle").value(auth.handle()))
                .andExpect(jsonPath("$.content").value("ownership post"))
                .andExpect(jsonPath("$.channel").value("home"));

        Long accountId = jdbcClient
                .sql("SELECT author_account_id FROM posts WHERE content = ?")
                .param("ownership post")
                .query(Long.class)
                .single();
        assertThat(accountId).isEqualTo(auth.accountId());

        String dbAuthor = jdbcClient
                .sql("SELECT author FROM posts WHERE content = ?")
                .param("ownership post")
                .query(String.class)
                .single();
        assertThat(dbAuthor).isEqualTo(auth.displayName());
    }

    // ── Authenticated reply creation ────────────────────────────────────────

    @Test
    void authenticatedReplyCreatesOwnershipAndReturnsHandle() throws Exception {
        AuthSession auth = registerAndLogin();
        Post parent = postRepository.insert("Tester", "Parent for reply ownership", "home");

        mockMvc.perform(post("/api/posts/" + parent.id() + "/replies")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"ownership reply"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value(auth.displayName()))
                .andExpect(jsonPath("$.authorHandle").value(auth.handle()))
                .andExpect(jsonPath("$.content").value("ownership reply"))
                .andExpect(jsonPath("$.postId").value(parent.id()));

        Long accountId = jdbcClient
                .sql("SELECT author_account_id FROM replies WHERE content = ?")
                .param("ownership reply")
                .query(Long.class)
                .single();
        assertThat(accountId).isEqualTo(auth.accountId());

        String dbAuthor = jdbcClient
                .sql("SELECT author FROM replies WHERE content = ?")
                .param("ownership reply")
                .query(String.class)
                .single();
        assertThat(dbAuthor).isEqualTo(auth.displayName());
    }

    // ── Spoofed author field ────────────────────────────────────────────────

    @Test
    void spoofedAuthorFieldDoesNotChangeOwner() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(post("/api/posts")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"author":"spoofed","content":"spoof attempt","channel":"home"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value(auth.displayName()))
                .andExpect(jsonPath("$.authorHandle").value(auth.handle()))
                .andExpect(jsonPath("$.content").value("spoof attempt"));

        Long accountId = jdbcClient
                .sql("SELECT author_account_id FROM posts WHERE content = ?")
                .param("spoof attempt")
                .query(Long.class)
                .single();
        assertThat(accountId).isEqualTo(auth.accountId());

        String dbAuthor = jdbcClient
                .sql("SELECT author FROM posts WHERE content = ?")
                .param("spoof attempt")
                .query(String.class)
                .single();
        assertThat(dbAuthor).isEqualTo(auth.displayName());
    }

    // ── Legacy content ──────────────────────────────────────────────────────

    @Test
    void legacyPostReturnsOriginalAuthorAndNullHandle() throws Exception {
        Post legacy = postRepository.insert("Legacy Author", "legacy content", "home");

        String response = mockMvc.perform(get("/api/posts"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode timeline = objectMapper.readTree(response);
        JsonNode item = findPost(timeline, legacy.id());

        assertThat(item.path("author").asText()).isEqualTo("Legacy Author");
        assertThat(item.path("authorHandle").isNull()).isTrue();

        Long accountId = jdbcClient
                .sql("SELECT author_account_id FROM posts WHERE id = ?")
                .param(legacy.id())
                .query(Long.class)
                .optional()
                .orElse(null);
        assertThat(accountId).isNull();
    }

    @Test
    void legacyReplyReturnsOriginalAuthorAndNullHandle() throws Exception {
        Post parent = postRepository.insert("Parent Author", "parent content", "home");
        Reply legacyReply = replyRepository.insert(parent.id(), "Legacy Replier", "legacy reply");

        String response = mockMvc.perform(get("/api/posts/" + parent.id() + "/replies"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode page = objectMapper.readTree(response);
        JsonNode item = findReply(page, legacyReply.id());

        assertThat(item.path("author").asText()).isEqualTo("Legacy Replier");
        assertThat(item.path("authorHandle").isNull()).isTrue();

        Long accountId = jdbcClient
                .sql("SELECT author_account_id FROM replies WHERE id = ?")
                .param(legacyReply.id())
                .query(Long.class)
                .optional()
                .orElse(null);
        assertThat(accountId).isNull();
    }

    private static JsonNode findPost(JsonNode page, long id) {
        for (JsonNode item : page.path("items")) {
            if (item.path("id").asLong() == id) {
                return item;
            }
        }
        throw new AssertionError("Expected post " + id + " in page");
    }

    private static JsonNode findReply(JsonNode page, long id) {
        for (JsonNode item : page.path("items")) {
            if (item.path("id").asLong() == id) {
                return item;
            }
        }
        throw new AssertionError("Expected reply " + id + " in page");
    }
}
