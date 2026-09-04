package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Post;
import com.example.deck.repository.PostRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ProfileContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PostRepository postRepository;

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
        String handle = "prof" + suffix;
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
        String displayName = "Profile Test";
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

    // ── Public profile GET ──────────────────────────────────────────────────

    @Test
    void publicProfileReturnsCorrectShapeAndIsCaseInsensitive() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(get("/api/profiles/" + auth.handle()))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.handle").value(auth.handle()))
                .andExpect(jsonPath("$.displayName").value(auth.displayName()))
                .andExpect(jsonPath("$.bio").value(""))
                .andExpect(jsonPath("$.createdAt").isString())
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());

        mockMvc.perform(get("/api/profiles/" + auth.handle().toUpperCase()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.handle").value(auth.handle()))
                .andExpect(jsonPath("$.displayName").value(auth.displayName()));
    }

    @Test
    void publicProfileNotFoundReturnsProblemDetails() throws Exception {
        String requestId = "profile-notfound-42";

        mockMvc.perform(get("/api/profiles/this-handle-does-not-exist")
                        .header("X-Request-ID", requestId))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(header().string("X-Request-ID", requestId))
                .andExpect(jsonPath("$.code").value("PROFILE_NOT_FOUND"))
                .andExpect(jsonPath("$.requestId").value(requestId));
    }

    @Test
    void publicProfileWithSyntacticallyInvalidHandleReturnsNotFound() throws Exception {
        String requestId = "profile-invalid-42";

        mockMvc.perform(get("/api/profiles/ab")
                        .header("X-Request-ID", requestId))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("PROFILE_NOT_FOUND"))
                .andExpect(jsonPath("$.requestId").value(requestId));

        mockMvc.perform(get("/api/profiles/" + "a".repeat(16))
                        .header("X-Request-ID", requestId))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("PROFILE_NOT_FOUND"));

        mockMvc.perform(get("/api/profiles/bad-handle")
                        .header("X-Request-ID", requestId))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("PROFILE_NOT_FOUND"));
    }

    // ── Anonymous PATCH /api/profiles/me ────────────────────────────────────

    @Test
    void anonymousPatchProfilesMeReturnsAuthRequired() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        long before = jdbcClient.sql("SELECT COUNT(*) FROM accounts")
                .query(Long.class)
                .single();

        mockMvc.perform(patch("/api/profiles/me")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Hacker","bio":"malicious"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        assertThat(jdbcClient.sql("SELECT COUNT(*) FROM accounts").query(Long.class).single())
                .isEqualTo(before);
    }

    @Test
    void anonymousPatchProfilesMeDoesNotChangeProfile() throws Exception {
        AuthSession auth = registerAndLogin();
        String originalDisplayName = auth.displayName();

        MockHttpSession anonymousSession = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(anonymousSession);

        mockMvc.perform(patch("/api/profiles/me")
                        .session(anonymousSession)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Hacker","bio":"malicious"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        String dbDisplayName = jdbcClient
                .sql("SELECT display_name FROM accounts WHERE handle = ?")
                .param(auth.handle())
                .query(String.class)
                .single();
        assertThat(dbDisplayName).isEqualTo(originalDisplayName);
    }

    // ── Authenticated PATCH /api/profiles/me ────────────────────────────────

    @Test
    void authenticatedPatchTrimsDisplayNameAndBio() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"  Updated Name  ","bio":"  My new bio  "}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.handle").value(auth.handle()))
                .andExpect(jsonPath("$.displayName").value("Updated Name"))
                .andExpect(jsonPath("$.bio").value("My new bio"))
                .andExpect(jsonPath("$.id").doesNotExist())
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist());
    }

    @Test
    void authenticatedPatchIgnoresSpoofedHandleField() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Spoof Test","bio":"","handle":"spoofed_handle"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.handle").value(auth.handle()))
                .andExpect(jsonPath("$.displayName").value("Spoof Test"));

        String dbHandle = jdbcClient
                .sql("SELECT handle FROM accounts WHERE id = ?")
                .param(auth.accountId())
                .query(String.class)
                .single();
        assertThat(dbHandle).isEqualTo(auth.handle());
    }

    @Test
    void authenticatedPatchIsReflectedBySession() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Session Check","bio":"reflected in session"}
                                """))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/auth/session")
                        .session(auth.session()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.account.handle").value(auth.handle()))
                .andExpect(jsonPath("$.account.displayName").value("Session Check"))
                .andExpect(jsonPath("$.account.bio").value("reflected in session"));
    }

    @Test
    void patchWithOverlongBioReturnsValidationFailed() throws Exception {
        AuthSession auth = registerAndLogin();
        String originalDisplayName = auth.displayName();
        String originalBio = "";

        String overlongBio = "A".repeat(161);

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Should Not Change","bio":"%s"}
                                """.formatted(overlongBio)))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        String dbDisplayName = jdbcClient
                .sql("SELECT display_name FROM accounts WHERE id = ?")
                .param(auth.accountId())
                .query(String.class)
                .single();
        String dbBio = jdbcClient
                .sql("SELECT bio FROM accounts WHERE id = ?")
                .param(auth.accountId())
                .query(String.class)
                .single();
        assertThat(dbDisplayName).isEqualTo(originalDisplayName);
        assertThat(dbBio).isEqualTo(originalBio);
    }

    // ── Display name resolution on timeline ─────────────────────────────────

    @Test
    void displayNameUpdateChangesResolvedAuthorOnOwnedPosts() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(post("/api/posts")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"owned post for resolution","channel":"home"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.author").value(auth.displayName()))
                .andExpect(jsonPath("$.authorHandle").value(auth.handle()));

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"New Resolved Name","bio":""}
                                """))
                .andExpect(status().isOk());

        String response = mockMvc.perform(get("/api/posts"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode timeline = objectMapper.readTree(response);
        JsonNode item = findPostByContent(timeline, "owned post for resolution");
        assertThat(item.path("author").asText()).isEqualTo("New Resolved Name");
        assertThat(item.path("authorHandle").asText()).isEqualTo(auth.handle());
    }

    @Test
    void displayNameUpdateKeepsOriginalAuthorSnapshot() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(post("/api/posts")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"content":"snapshot check","channel":"home"}
                                """))
                .andExpect(status().isCreated());

        mockMvc.perform(patch("/api/profiles/me")
                        .session(auth.session())
                        .header(auth.csrf().headerName(), auth.csrf().token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"After Snapshot","bio":""}
                                """))
                .andExpect(status().isOk());

        String dbAuthor = jdbcClient
                .sql("SELECT author FROM posts WHERE content = ?")
                .param("snapshot check")
                .query(String.class)
                .single();
        assertThat(dbAuthor).isEqualTo(auth.displayName());
    }

    // ── Profile posts ───────────────────────────────────────────────────────

    @Test
    void profilePostsReturnsOnlyOwnedPosts() throws Exception {
        AuthSession auth = registerAndLogin();

        Post owned = postRepository.insertOwned(auth.accountId(), "owned post one", "home");
        Post owned2 = postRepository.insertOwned(auth.accountId(), "owned post two", "tech");

        mockMvc.perform(get("/api/profiles/" + auth.handle() + "/posts"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items", hasSize(2)))
                .andExpect(jsonPath("$.items[?(@.id == " + owned.id() + ")].content")
                        .value("owned post one"))
                .andExpect(jsonPath("$.items[?(@.id == " + owned2.id() + ")].content")
                        .value("owned post two"));
    }

    @Test
    void profilePostsExcludesLegacyAndOtherAccountPosts() throws Exception {
        AuthSession auth = registerAndLogin();
        AuthSession otherAuth = registerAndLogin();

        postRepository.insertOwned(auth.accountId(), "alice owned", "home");
        postRepository.insertOwned(otherAuth.accountId(), "bob owned", "home");
        Post legacy = postRepository.insert("Legacy Author", "legacy content", "home");

        String response = mockMvc.perform(get("/api/profiles/" + auth.handle() + "/posts"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode page = objectMapper.readTree(response);
        Set<String> contents = new HashSet<>();
        page.path("items").forEach(item -> contents.add(item.path("content").asText()));

        assertThat(contents).containsExactly("alice owned");
        assertThat(contents).doesNotContain("bob owned", "legacy content");
    }

    @Test
    void profilePostsPaginationSupportsLimitAndBefore() throws Exception {
        AuthSession auth = registerAndLogin();

        insertOwnedAt(auth.accountId(), "post one", "home", "9999-12-31 23:59:56");
        insertOwnedAt(auth.accountId(), "post two", "home", "9999-12-31 23:59:57");
        insertOwnedAt(auth.accountId(), "post three", "home", "9999-12-31 23:59:58");
        insertOwnedAt(auth.accountId(), "post four", "home", "9999-12-31 23:59:59");

        JsonNode firstPage = getProfilePage(auth.handle(), 2, null);
        assertThat(firstPage.path("items")).hasSize(2);
        assertThat(firstPage.path("items").get(0).path("content").asText()).isEqualTo("post four");
        assertThat(firstPage.path("items").get(1).path("content").asText()).isEqualTo("post three");
        assertThat(firstPage.path("nextCursor").isNull()).isFalse();

        JsonNode secondPage = getProfilePage(auth.handle(), 2,
                firstPage.path("nextCursor").asText());
        assertThat(secondPage.path("items")).hasSize(2);
        assertThat(secondPage.path("items").get(0).path("content").asText()).isEqualTo("post two");
        assertThat(secondPage.path("items").get(1).path("content").asText()).isEqualTo("post one");
        assertThat(secondPage.path("nextCursor").isNull()).isTrue();
    }

    @Test
    void profilePostsPaginationHasNoDuplicates() throws Exception {
        AuthSession auth = registerAndLogin();

        insertOwnedAt(auth.accountId(), "first", "home", "9999-12-31 23:59:58");
        insertOwnedAt(auth.accountId(), "second", "home", "9999-12-31 23:59:59");
        insertOwnedAt(auth.accountId(), "third", "home", "9999-12-31 23:59:59");

        JsonNode firstPage = getProfilePage(auth.handle(), 2, null);
        Post newlyInserted = insertOwnedAt(
                auth.accountId(), "new post", "home", "9999-12-31 23:59:59");
        JsonNode secondPage = getProfilePage(auth.handle(), 2,
                firstPage.path("nextCursor").asText());

        assertThat(itemIds(firstPage))
                .doesNotContainAnyElementsOf(itemIds(secondPage))
                .doesNotContain(newlyInserted.id());
    }

    @Test
    void profilePostsForUnknownHandleReturnsNotFound() throws Exception {
        mockMvc.perform(get("/api/profiles/nonexistent_handle/posts"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("PROFILE_NOT_FOUND"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"0", "101", "not-a-number"})
    void profilePostsRejectInvalidLimit(String limit) throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(get("/api/profiles/" + auth.handle() + "/posts")
                        .param("limit", limit))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_LIMIT"));
    }

    @Test
    void profilePostsRejectInvalidCursor() throws Exception {
        AuthSession auth = registerAndLogin();

        mockMvc.perform(get("/api/profiles/" + auth.handle() + "/posts")
                        .param("before", "invalid"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_CURSOR"));
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private JsonNode getProfilePage(String handle, int limit, String before) throws Exception {
        MockHttpServletRequestBuilder request = get("/api/profiles/" + handle + "/posts")
                .param("limit", Integer.toString(limit));
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

    private Post insertOwnedAt(long accountId, String content, String channel, String createdAt) {
        Post post = postRepository.insertOwned(accountId, content, channel);
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }

    private static Set<Long> itemIds(JsonNode page) {
        Set<Long> ids = new HashSet<>();
        page.path("items").forEach(item -> ids.add(item.path("id").asLong()));
        return ids;
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
