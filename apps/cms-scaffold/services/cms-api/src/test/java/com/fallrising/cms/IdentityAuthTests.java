package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class IdentityAuthTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String FRONT = "http://localhost:5173";
    static final String BACK = "http://localhost:5174";
    static final String ADMIN = "http://localhost:5175";

    @Autowired
    MockMvc mockMvc;

    @Test
    void meWithoutSessionIs401() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
    }

    @Test
    void loginFailureDoesNotLeakAccount() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .content("""
                                {"username":"nobody","password":"definitely-wrong-password"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"))
                .andExpect(header().doesNotExist("Set-Cookie"));

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .content("""
                                {"username":"seed-admin","password":"definitely-wrong-password"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void csrfRequiredForCookieMutatingRequests() throws Exception {
        Session session = login("seed-editor-album", BACK);
        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Origin", BACK)
                        .cookie(session.sessionCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("CSRF_FAILED"));

        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie()))
                .andExpect(status().isNoContent());
    }

    @Test
    void bearerSkipsCsrf() throws Exception {
        Session session = login("seed-operator-album", BACK);
        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Origin", BACK)
                        .header("Authorization", "Bearer " + session.token)
                        .header("X-CMS-Surface", "back"))
                .andExpect(status().isNoContent());
    }

    @Test
    void corsAllowlistEchoesOrigin() throws Exception {
        mockMvc.perform(options("/api/v1/auth/login")
                        .header("Origin", BACK)
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "X-CSRF-Token,Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string("Access-Control-Allow-Origin", BACK))
                .andExpect(header().string("Access-Control-Allow-Credentials", "true"));

        mockMvc.perform(options("/api/v1/auth/login")
                        .header("Origin", "http://evil.example")
                        .header("Access-Control-Request-Method", "POST")
                        .header("Access-Control-Request-Headers", "X-CSRF-Token"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test
    void loginFromUnknownOriginIsCsrfFailed() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", "http://evil.example")
                        .content("""
                                {"username":"seed-admin","password":"%s"}
                                """.formatted(PASSWORD)))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"))
                .andReturn();
        assertThat(cookie(result, "cms_session")).isNull();
        assertThat(result.getResponse().getContentAsString()).doesNotContain("\"username\":\"seed-admin\"");
    }

    @Test
    void editorPublishIsForbidden() throws Exception {
        Session session = login("seed-editor-album", BACK);
        String id = createAlbum(session, "editor-cannot-publish");
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.action").value("publish"))
                .andExpect(jsonPath("$.error.contentType").value("album"))
                .andExpect(jsonPath("$.error.surface").value("back"));
        mockMvc.perform(get("/api/v1/entries/" + id).header("Origin", BACK).cookie(session.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("draft"));
    }

    @Test
    void operatorPublishAlbumIsAllowed() throws Exception {
        Session session = login("seed-operator-album", BACK);
        String id = createAlbum(session, "operator-can-publish");
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("published"));
    }

    @Test
    void operatorClinicCannotPublishAlbum() throws Exception {
        Session albumOp = login("seed-operator-album", BACK);
        String id = createAlbum(albumOp, "clinic-cannot-publish-album");
        Session clinic = login("seed-operator-clinic", BACK);
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", clinic.csrf)
                        .cookie(clinic.sessionCookie(), clinic.csrfCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void backSessionCannotReadDraftOnFront() throws Exception {
        Session session = login("seed-editor-album", BACK);
        String id = createAlbum(session, "front-cannot-see-draft");
        mockMvc.perform(get("/api/v1/entries/" + id).header("Origin", FRONT).cookie(session.sessionCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));

        mockMvc.perform(get("/api/v1/auth/me").header("Origin", FRONT).cookie(session.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.principal.username").value("seed-editor-album"));

        mockMvc.perform(get("/api/v1/entries/" + id).header("Origin", BACK).cookie(session.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("draft"));
    }

    @Test
    void memberCannotUseBackWorkApi() throws Exception {
        Session session = login("seed-member-clinic", FRONT);
        mockMvc.perform(get("/api/v1/content-types/album/entries")
                        .param("state", "draft")
                        .header("Origin", BACK)
                        .cookie(session.sessionCookie()))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminGovernanceRejectedOnFront() throws Exception {
        Session session = login("seed-admin", ADMIN);
        mockMvc.perform(get("/api/v1/principals").header("Origin", FRONT).cookie(session.sessionCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));

        mockMvc.perform(get("/api/v1/principals").header("Origin", ADMIN).cookie(session.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());
    }

    @Test
    void lastAdminCannotDisableSelf() throws Exception {
        Session session = login("seed-admin", ADMIN);
        String id = mockMvc.perform(get("/api/v1/auth/me").header("Origin", ADMIN).cookie(session.sessionCookie()))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        String principalId = id.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(post("/api/v1/principals/" + principalId + "/disable")
                        .header("Origin", ADMIN)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("LAST_ADMIN"));
    }

    @Test
    void lockoutAfterFiveFailures() throws Exception {
        String username = "seed-member-projects";
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .header("Origin", FRONT)
                            .content("""
                                    {"username":"%s","password":"wrong-password-xx"}
                                    """.formatted(username)))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.error.code").value("INVALID_CREDENTIALS"));
        }
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", FRONT)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, PASSWORD)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("ACCOUNT_LOCKED"));
    }

    @Test
    void seedFilesHaveNoPlaintextPasswords() throws Exception {
        String sql = new ClassPathResource("db/migration/V2__identity.sql")
                .getContentAsString(StandardCharsets.UTF_8);
        assertThat(sql.toLowerCase()).doesNotContain("secret_hash) values", "password =", "admin/admin", "passw0rd!");
        Path seedJava = Path.of("src/main/java/com/fallrising/cms/identity/service/SeedService.java");
        if (!Files.exists(seedJava)) {
            seedJava = Path.of("services/cms-api/src/main/java/com/fallrising/cms/identity/service/SeedService.java");
        }
        String seed = Files.readString(seedJava, StandardCharsets.UTF_8);
        assertThat(seed).doesNotContain("admin/admin", "Passw0rd!", "password123", "CMS_SEED_PASSWORD=");
        String openapi = new ClassPathResource("openapi/openapi.yaml").getContentAsString(StandardCharsets.UTF_8);
        assertThat(openapi).doesNotContain("admin/admin", "Passw0rd!");
    }

    private String createAlbum(Session session, String slug) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/content-types/album/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie())
                        .content("""
                                {"slug":"%s","payload":{"title":"%s"}}
                                """.formatted(slug, slug)))
                .andExpect(status().isCreated())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        return body.replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
    }

    private Session login(String username, String origin) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", origin)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.principal.username").value(username))
                .andReturn();
        String token = cookie(result, "cms_session");
        String csrf = cookie(result, "cms_csrf");
        assertThat(token).isNotBlank();
        assertThat(csrf).isNotBlank();
        assertThat(result.getResponse().getHeaders("Set-Cookie").stream().anyMatch(v -> v.startsWith("JSESSIONID=")))
                .isFalse();
        return new Session(token, csrf);
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElse(null);
    }

    private record Session(String token, String csrf) {
        MockCookie sessionCookie() {
            MockCookie cookie = new MockCookie("cms_session", token);
            cookie.setPath("/");
            cookie.setHttpOnly(true);
            return cookie;
        }

        MockCookie csrfCookie() {
            MockCookie cookie = new MockCookie("cms_csrf", csrf);
            cookie.setPath("/");
            return cookie;
        }
    }
}
