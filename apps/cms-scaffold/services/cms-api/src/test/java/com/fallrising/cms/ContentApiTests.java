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
import java.util.Locale;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ContentApiTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String BACK = "http://localhost:5174";

    @Autowired
    MockMvc mockMvc;

    @Test
    void flywayContentHasNoAlbumTable() throws Exception {
        String sql = new ClassPathResource("db/migration/V3__content.sql")
                .getContentAsString(StandardCharsets.UTF_8)
                .toLowerCase(Locale.ROOT)
                .replaceAll("(?m)--.*$", "");
        assertThat(sql).contains("create table cms_entry");
        assertThat(sql).contains("create table cms_content_type");
        assertThat(sql).doesNotContain("create table album", "create table photo", "create table cms_media");
    }

    @Test
    void draftIsHiddenOnPublicApiUntilPublish() throws Exception {
        Session op = login("seed-operator-album");
        String slug = "summer-" + UUID.randomUUID().toString().substring(0, 8);
        String id = createAlbum(op, slug, "Summer");

        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/" + slug))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id).param("state", "draft"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUDIENCE_PARAM_REJECTED"));

        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("published"));

        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Summer"))
                .andExpect(jsonPath("$.payload.title").value("Summer"))
                .andExpect(jsonPath("$.publicationState").doesNotExist())
                .andExpect(jsonPath("$.version").doesNotExist());

        mockMvc.perform(patch("/api/v1/entries/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"title":"Dirty draft title"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.title").value("Dirty draft title"))
                .andExpect(jsonPath("$.dirty").value(true));

        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Summer"))
                .andExpect(jsonPath("$.payload.title").value("Summer"));
    }

    @Test
    void invalidTransitionIsConflict() throws Exception {
        Session op = login("seed-operator-album");
        String id = createAlbum(op, "restore-" + UUID.randomUUID().toString().substring(0, 8), "X");
        mockMvc.perform(post("/api/v1/entries/" + id + "/unpublish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("INVALID_STATE_TRANSITION"));
    }

    @Test
    void photoPublicRequiresPublishedAlbum() throws Exception {
        Session op = login("seed-operator-album");
        String albumId = createAlbum(op, "parent-" + UUID.randomUUID().toString().substring(0, 8), "Parent");
        MvcResult photo = mockMvc.perform(post("/api/v1/content-types/photo/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"title":"Shot","album":"%s","sortOrder":1}}
                                """.formatted(albumId)))
                .andExpect(status().isCreated())
                .andReturn();
        String photoId = photo.getResponse().getContentAsString().replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(post("/api/v1/entries/" + photoId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries/" + photoId))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/v1/entries/" + albumId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries/" + photoId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.album").value(albumId));
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

    private Session login(String username) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
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
