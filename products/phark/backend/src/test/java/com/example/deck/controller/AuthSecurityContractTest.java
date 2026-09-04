package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.dto.LoginRequest;
import com.example.deck.dto.RegisterAccountRequest;
import com.example.deck.repository.AccountRepository;
import com.example.deck.security.AccountPrincipal;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.web.server.Cookie;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AuthSecurityContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private ServerProperties serverProperties;

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

    // ── CSRF endpoint contract ─────────────────────────────────────────────

    @Test
    void csrfEndpointReturnsHeaderNameTokenAndNoStore() throws Exception {
        mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.headerName").value("X-CSRF-TOKEN"))
                .andExpect(jsonPath("$.token").isString())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(header().string("Cache-Control", containsString("no-store")));
    }

    @Test
    void sessionCookieDefaultsAreHttpOnlyAndSameSiteLax() {
        Cookie cookie = serverProperties.getServlet().getSession().getCookie();
        assertThat(cookie.getHttpOnly()).isTrue();
        assertThat(cookie.getSameSite()).isEqualTo(Cookie.SameSite.LAX);
        assertThat(cookie.getSecure()).isFalse();
    }

    // ── CSRF protection ────────────────────────────────────────────────────

    @Test
    void unsafePostWithoutCsrfReturns403AndInsertsNoAccount() throws Exception {
        String handle = "csrf" + uniqueSuffix();
        String body = regBody(handle, "CSRF Test", "password-12345678");
        String requestId = "csrf-contract-42";

        mockMvc.perform(post("/api/accounts")
                        .header("X-Request-ID", requestId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(header().string("X-Request-ID", requestId))
                .andExpect(jsonPath("$.code").value("CSRF_TOKEN_INVALID"))
                .andExpect(jsonPath("$.requestId").value(requestId));

        assertThat(accountRepository.findByHandle(handle)).isEmpty();
    }

    @Test
    void anonymousProtectedMutationReturns401ProblemDetails() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String requestId = "auth-contract-42";

        mockMvc.perform(post("/api/posts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .header("X-Request-ID", requestId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"author":"spoofed","content":"must not persist","channel":"home"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(header().string("X-Request-ID", requestId))
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"))
                .andExpect(jsonPath("$.requestId").value(requestId));
    }

    // ── Registration ───────────────────────────────────────────────────────

    @Test
    void registerWithValidCsrfReturns201PublicProfile() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "reg" + uniqueSuffix();
        String body = regBody("  " + handle + "  ", "  Alice  ", "correct horse battery staple");

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isCreated())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.handle").value(handle))
                .andExpect(jsonPath("$.displayName").value("Alice"))
                .andExpect(jsonPath("$.bio").value(""))
                .andExpect(jsonPath("$.createdAt").isString())
                .andExpect(jsonPath("$.password").doesNotExist())
                .andExpect(jsonPath("$.passwordHash").doesNotExist())
                .andExpect(jsonPath("$.id").doesNotExist());
    }

    @Test
    void duplicateCanonicalHandleReturns409() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "dup" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "First", "password-12345678")))
                .andExpect(status().isCreated());

        MockHttpSession session2 = new MockHttpSession();
        CsrfToken csrf2 = fetchCsrf(session2);
        mockMvc.perform(post("/api/accounts")
                        .session(session2)
                        .header(csrf2.headerName(), csrf2.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle.toUpperCase(), "Second", "other-password-1234")))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("HANDLE_UNAVAILABLE"))
                .andExpect(jsonPath("$.detail").value("The requested handle is not available."));
    }

    // ── Login ──────────────────────────────────────────────────────────────

    @Test
    void badLoginMissingHandleReturns401Generic() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String body = loginBody("missing" + uniqueSuffix(), "whatever-12345678");

        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void badLoginWrongPasswordReturns401Generic() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "wrong" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "Login Test", "correct password here")))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, "wrong password here!!!!")))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void missingAndWrongPasswordReturnSameDetail() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "detail" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "Detail Test", "valid password here")))
                .andExpect(status().isCreated());

        String missingBody = loginBody("missing" + uniqueSuffix(), "whatever-12345678");
        String wrongPwBody = loginBody(handle, "wrong password here");

        MvcResult missingResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(missingBody))
                .andExpect(status().isUnauthorized())
                .andReturn();

        MvcResult wrongPwResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wrongPwBody))
                .andExpect(status().isUnauthorized())
                .andReturn();

        JsonNode missing = objectMapper.readTree(missingResult.getResponse().getContentAsString());
        JsonNode wrongPw = objectMapper.readTree(wrongPwResult.getResponse().getContentAsString());
        assertThat(missing.get("detail").asText())
                .as("detail must not distinguish missing handle from wrong password")
                .isEqualTo(wrongPw.get("detail").asText());
        assertThat(missing.get("code").asText())
                .as("code must not distinguish missing handle from wrong password")
                .isEqualTo(wrongPw.get("code").asText());
    }

    @Test
    void successfulLoginRotatesSessionIdAndPersists() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "rotate" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "Rotate Test", "session rotate password")))
                .andExpect(status().isCreated());

        String preLoginSessionId = session.getId();

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, "session rotate password")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.account.handle").value(handle))
                .andExpect(jsonPath("$.account.displayName").value("Rotate Test"))
                .andExpect(jsonPath("$.account.password").doesNotExist())
                .andExpect(jsonPath("$.account.passwordHash").doesNotExist())
                .andExpect(jsonPath("$.account.id").doesNotExist())
                .andReturn();

        MockHttpSession postLoginSession = (MockHttpSession) loginResult.getRequest().getSession();
        assertThat(postLoginSession).isNotNull();
        assertThat(postLoginSession.getId())
                .as("session ID must be rotated after login")
                .isNotEqualTo(preLoginSessionId);
        SecurityContext securityContext = (SecurityContext) postLoginSession.getAttribute(
                HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
        assertThat(securityContext.getAuthentication().getCredentials()).isNull();
        assertThat((AccountPrincipal) securityContext.getAuthentication().getPrincipal())
                .extracting(AccountPrincipal::getPassword)
                .isNull();

        mockMvc.perform(get("/api/auth/session")
                        .session(postLoginSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.account.handle").value(handle));
    }

    @Test
    void credentialDtoStringsRedactPasswords() {
        String password = "never print this password";

        assertThat(new LoginRequest("alice", password).toString())
                .doesNotContain(password)
                .contains("<redacted>");
        assertThat(new RegisterAccountRequest("alice", "Alice", password).toString())
                .doesNotContain(password)
                .contains("<redacted>");
    }

    @Test
    void preLoginCsrfInvalidAfterLogin() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "old" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "Old CSRF", "csrf old password")))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, "csrf old password")))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody("next" + uniqueSuffix(), "Another", "password-12345678")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_TOKEN_INVALID"));
    }

    @Test
    void refreshedCsrfWorksAfterLogin() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "new" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "New CSRF", "csrf new password")))
                .andExpect(status().isCreated());

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, "csrf new password")))
                .andExpect(status().isOk())
                .andReturn();

        MockHttpSession postLoginSession = (MockHttpSession) loginResult.getRequest().getSession();
        CsrfToken refreshed = fetchCsrf(postLoginSession);

        mockMvc.perform(post("/api/accounts")
                        .session(postLoginSession)
                        .header(refreshed.headerName(), refreshed.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody("next" + uniqueSuffix(), "Another", "password-12345678")))
                .andExpect(status().isCreated());
    }

    // ── Logout ─────────────────────────────────────────────────────────────

    @Test
    void logoutRequiresCsrfReturns204AndInvalidates() throws Exception {
        MockHttpSession session = new MockHttpSession();
        CsrfToken csrf = fetchCsrf(session);
        String handle = "logout" + uniqueSuffix();

        mockMvc.perform(post("/api/accounts")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(regBody(handle, "Logout Test", "logout password here")))
                .andExpect(status().isCreated());

        MvcResult loginResult = mockMvc.perform(post("/api/auth/login")
                        .session(session)
                        .header(csrf.headerName(), csrf.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(handle, "logout password here")))
                .andExpect(status().isOk())
                .andReturn();

        MockHttpSession postLoginSession = (MockHttpSession) loginResult.getRequest().getSession();
        CsrfToken postLoginCsrf = fetchCsrf(postLoginSession);

        mockMvc.perform(post("/api/auth/logout")
                        .session(postLoginSession))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/auth/logout")
                        .session(postLoginSession)
                        .header(postLoginCsrf.headerName(), postLoginCsrf.token()))
                .andExpect(status().isNoContent());

        MvcResult sessionResult = mockMvc.perform(get("/api/auth/session"))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode sessionBody = objectMapper.readTree(sessionResult.getResponse().getContentAsString());
        assertThat(sessionBody.has("account")).isTrue();
        assertThat(sessionBody.get("account").isNull()).isTrue();
    }
}
