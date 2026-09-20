package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class WaveEAcceptanceTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String FRONT = "http://localhost:5173";
    static final String BACK = "http://localhost:5174";
    static final String ADMIN = "http://localhost:5175";

    @Autowired
    MockMvc mockMvc;

    @Test
    void tRbacFFrontCannotReadDrafts() throws Exception {
        Session op = login("seed-operator-album", BACK);
        String slug = "rbac-" + UUID.randomUUID().toString().substring(0, 8);
        String id = createAlbum(op, slug, "Hidden Draft");

        mockMvc.perform(get("/api/v1/entries/" + id).header("Origin", FRONT).cookie(op.sessionCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id).header("Origin", FRONT))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").header("Origin", FRONT))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].slug", not(hasItem(slug))));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id)
                        .header("Origin", FRONT)
                        .param("includeDraft", "true"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUDIENCE_PARAM_REJECTED"));
        MvcResult hidden = mockMvc.perform(get("/api/v1/public/content-types/album/slugs/" + slug).header("Origin", FRONT))
                .andExpect(status().isNotFound())
                .andReturn();
        org.assertj.core.api.Assertions.assertThat(hidden.getResponse().getContentAsString())
                .doesNotContain("Hidden Draft", "publicationState");
    }

    @Test
    void tCt04UnpublishHidesPublicGet() throws Exception {
        Session op = login("seed-operator-album", BACK);
        String slug = "unpub-" + UUID.randomUUID().toString().substring(0, 8);
        String id = createAlbum(op, slug, "Live Then Gone");
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/entries/" + id + "/unpublish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isNotFound());
    }

    @Test
    void tCt05PublishWritesRevisionAndDropsOldest() throws Exception {
        Session op = login("seed-operator-album", BACK);
        String id = createAlbum(op, "rev-" + UUID.randomUUID().toString().substring(0, 8), "R0");
        for (int i = 0; i < 21; i++) {
            mockMvc.perform(patch("/api/v1/entries/" + id)
                            .contentType(MediaType.APPLICATION_JSON)
                            .header("Origin", BACK)
                            .header("X-CSRF-Token", op.csrf)
                            .cookie(op.sessionCookie(), op.csrfCookie())
                            .content("""
                                    {"payload":{"title":"R%d"}}
                                    """.formatted(i)))
                    .andExpect(status().isOk());
            mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                            .header("Origin", BACK)
                            .header("X-CSRF-Token", op.csrf)
                            .cookie(op.sessionCookie(), op.csrfCookie()))
                    .andExpect(status().isOk());
        }
        mockMvc.perform(get("/api/v1/entries/" + id + "/revisions")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(20));
    }

    @Test
    void tCt06SoftDeleteHidesThenAdminPurgeAudits() throws Exception {
        Session op = login("seed-operator-album", BACK);
        String slug = "purge-" + UUID.randomUUID().toString().substring(0, 8);
        String id = createAlbum(op, slug, "To Purge");
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(delete("/api/v1/entries/" + id)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/v1/admin/entries/" + id + "/purge")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isForbidden());

        Session admin = login("seed-admin", ADMIN);
        mockMvc.perform(post("/api/v1/admin/entries/" + id + "/purge")
                        .header("Origin", ADMIN)
                        .header("X-CSRF-Token", admin.csrf)
                        .cookie(admin.sessionCookie(), admin.csrfCookie()))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/admin/audit")
                        .param("action", "ENTRY_PURGED")
                        .param("targetId", id)
                        .header("Origin", ADMIN)
                        .cookie(admin.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(greaterThanOrEqualTo(1)))
                .andExpect(jsonPath("$.items[0].action").value("ENTRY_PURGED"));
        mockMvc.perform(get("/api/v1/admin/audit")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isForbidden());
    }

    private String createAlbum(Session session, String slug, String title) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/content-types/album/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie())
                        .content("""
                                {"slug":"%s","payload":{"title":"%s"}}
                                """.formatted(slug, title)))
                .andExpect(status().isCreated())
                .andReturn();
        return result.getResponse().getContentAsString().replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
    }

    private Session login(String username, String origin) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", origin)
                        .content("""
                                {"username":"%s","password":"%s"}
                                """.formatted(username, PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        return new Session(cookie(result, "cms_session"), cookie(result, "cms_csrf"));
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
