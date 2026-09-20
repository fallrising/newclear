package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockCookie;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.UUID;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class DemoPackTests {

    static final String PASSWORD = "CmsWaveB1TestPw";
    static final String BACK = "http://localhost:5174";

    @Autowired
    MockMvc mockMvc;

    @Test
    void tAl01AlbumHappyPathUsesEntryApi() throws Exception {
        Session op = login("seed-operator-album");
        String slug = "wall-" + UUID.randomUUID().toString().substring(0, 8);
        String albumId = createEntry(op, "album", slug, """
                {"title":"Wall 2026","visibility":"public"}
                """);
        String[] media = new String[3];
        for (int i = 0; i < 3; i++) {
            media[i] = uploadPng(op, "shot-" + i + ".png");
            createEntry(op, "photo", slug + "-p" + i, """
                    {"title":"Shot %d","caption":"Caption %d","album":"%s","media":"%s","sortOrder":%d}
                    """.formatted(i + 1, i + 1, albumId, media[i], (i + 1) * 10));
        }
        mockMvc.perform(patch("/api/v1/entries/" + albumId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"cover":"%s"}}
                                """.formatted(media[0])))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/preview/entries/" + albumId)
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("draft"))
                .andExpect(jsonPath("$.payload.title").value("Wall 2026"));

        MvcResult photos = mockMvc.perform(get("/api/v1/content-types/photo/entries")
                        .param("ref.album", albumId)
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andReturn();
        String photoBody = photos.getResponse().getContentAsString();
        for (int i = 0; i < 3; i++) {
            String photoId = idFromSlug(photoBody, slug + "-p" + i);
            mockMvc.perform(post("/api/v1/entries/" + photoId + "/publish")
                            .header("Origin", BACK)
                            .header("X-CSRF-Token", op.csrf)
                            .cookie(op.sessionCookie(), op.csrfCookie()))
                    .andExpect(status().isOk());
        }
        mockMvc.perform(post("/api/v1/entries/" + albumId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/public/content-types/album/entries"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].slug", hasItem(slug)))
                .andExpect(jsonPath("$.items[*].title", hasItem("Wall 2026")));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", albumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].payload.sortOrder").value(10))
                .andExpect(jsonPath("$.items[1].payload.sortOrder").value(20))
                .andExpect(jsonPath("$.items[2].payload.sortOrder").value(30))
                .andExpect(jsonPath("$.items[0].payload.caption").value("Caption 1"))
                .andExpect(jsonPath("$.items[0].payload.media.variants.thumbnail.url").exists());
        mockMvc.perform(get("/api/v1/entries/" + albumId + "/revisions")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(org.hamcrest.Matchers.greaterThanOrEqualTo(1)));
        mockMvc.perform(get("/api/v1/albums").header("Origin", BACK).cookie(op.sessionCookie()))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/albums")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isNotFound());
        String draftSlug = "draft-" + UUID.randomUUID().toString().substring(0, 8);
        createEntry(op, "album", draftSlug, """
                {"title":"Still draft"}
                """);
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/" + draftSlug))
                .andExpect(status().isNotFound());
    }

    @Test
    void tAl02EditorCannotPublish() throws Exception {
        Session editor = login("seed-editor-album");
        String slug = "ed-" + UUID.randomUUID().toString().substring(0, 8);
        String id = createEntry(editor, "album", slug, """
                {"title":"Editor draft","visibility":"public"}
                """);
        mockMvc.perform(post("/api/v1/entries/" + id + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", editor.csrf)
                        .cookie(editor.sessionCookie(), editor.csrfCookie()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.action").value("publish"))
                .andExpect(jsonPath("$.error.contentType").value("album"));
        mockMvc.perform(get("/api/v1/entries/" + id).header("Origin", BACK).cookie(editor.sessionCookie()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("draft"));
        MvcResult hidden = mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + id))
                .andExpect(status().isNotFound())
                .andReturn();
        String body = hidden.getResponse().getContentAsString();
        assertThat(body).doesNotContain("Editor draft", "caption", "/api/v1/public/media/");
    }

    @Test
    void tAl03PublishedPhotoHiddenWhenAlbumDraft() throws Exception {
        Session op = login("seed-operator-album");
        String albumId = createEntry(op, "album", "parent-" + UUID.randomUUID().toString().substring(0, 8), """
                {"title":"Draft parent"}
                """);
        String photoId = createEntry(op, "photo", "shot-" + UUID.randomUUID().toString().substring(0, 8), """
                {"title":"Orphan shot","album":"%s","sortOrder":1}
                """.formatted(albumId));
        mockMvc.perform(post("/api/v1/entries/" + photoId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries/" + photoId))
                .andExpect(status().isNotFound());
    }

    @Test
    void tAl04UnlistedAlbumIsHiddenFromIndex() throws Exception {
        mockMvc.perform(get("/api/v1/public/content-types/album/entries"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].slug", hasItem("coast-light-2026")))
                .andExpect(jsonPath("$.items[*].slug", not(hasItem("unlisted-proof"))))
                .andExpect(jsonPath("$.items[*].slug", not(hasItem("private-studio"))));
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/unlisted-proof"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.slug").value("unlisted-proof"))
                .andExpect(jsonPath("$.title").value("Unlisted proof"));
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/private-studio"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/coast-light-2026"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.visibility").value("public"));
    }

    @Test
    void tAl05DraftAlbumMediaIsNotPublic() throws Exception {
        Session op = login("seed-operator-album");
        MvcResult photos = mockMvc.perform(get("/api/v1/content-types/photo/entries")
                        .param("q", "Polaroid")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andReturn();
        String mediaId = photos.getResponse().getContentAsString().replaceAll(".*\"media\":\"([^\"]+)\".*", "$1");
        assertThat(mediaId).matches("[0-9a-f-]{36}");
        mockMvc.perform(get("/api/v1/public/media/" + mediaId + "/file/original"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/public/media/" + mediaId + "/file/thumbnail"))
                .andExpect(status().isNotFound());
    }

    @Test
    void tAl06NoAlbumOrPhotoTables() throws Exception {
        Path dir = Path.of("src/main/resources/db/migration");
        if (!Files.isDirectory(dir)) {
            dir = Path.of("services/cms-api/src/main/resources/db/migration");
        }
        assertThat(dir).isDirectory();
        try (Stream<Path> files = Files.list(dir)) {
            String sql = files.filter(path -> path.getFileName().toString().endsWith(".sql"))
                    .map(path -> {
                        try {
                            return Files.readString(path, StandardCharsets.UTF_8);
                        } catch (Exception e) {
                            throw new RuntimeException(e);
                        }
                    })
                    .reduce("", (a, b) -> a + "\n" + b)
                    .toLowerCase(Locale.ROOT)
                    .replaceAll("(?m)--.*$", "");
            assertThat(sql).contains("create table cms_entry");
            assertThat(sql).doesNotContain(
                    "create table album",
                    "create table photo",
                    "create table owner",
                    "create table pet",
                    "create table project",
                    "create table issue");
        }
    }

    @Test
    void tPc01ClinicHappyPathHidesOwners() throws Exception {
        Session op = login("seed-operator-clinic");
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String ownerId = createEntry(op, "owner", "maria-" + suffix, """
                {"title":"Maria Santos","firstName":"Maria","lastName":"Santos"}
                """);
        String petId = createEntry(op, "pet", "nala-" + suffix, """
                {"title":"Nala","name":"Nala","petType":"cat","owner":"%s"}
                """.formatted(ownerId));
        MvcResult vets = mockMvc.perform(get("/api/v1/content-types/vet/entries")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andReturn();
        String carterId = idFromTitle(vets.getResponse().getContentAsString(), "James Carter");
        String visitId = createEntry(op, "visit", "nala-visit-" + suffix, """
                {"title":"Nala checkup","pet":"%s","owner":"%s","vet":"%s","description":"annual checkup","visitKind":"checkup","scheduledAt":"2026-09-12T09:00:00Z"}
                """.formatted(petId, ownerId, carterId));
        mockMvc.perform(post("/api/v1/entries/" + visitId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/public/content-types/clinic_profile/slugs/home"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("Cedar Pet Clinic"));
        mockMvc.perform(get("/api/v1/public/content-types/vet/entries"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].title", hasItems("James Carter", "Helen Leary")))
                .andExpect(jsonPath("$.items[*].title", not(hasItem("Linda Douglas"))));
        mockMvc.perform(get("/api/v1/public/content-types/owner/entries"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.action").value("read_published"))
                .andExpect(jsonPath("$.error.contentType").value("owner"));
        MvcResult ownerHidden = mockMvc.perform(get("/api/v1/public/content-types/owner/entries/" + ownerId))
                .andExpect(status().isForbidden())
                .andReturn();
        assertThat(ownerHidden.getResponse().getContentAsString()).doesNotContain("Maria Santos", "608555");
        mockMvc.perform(get("/api/v1/public/content-types/visit/entries"))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/public/content-types/vet/slugs/linda-douglas"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/clinic/owners")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isNotFound());
        Session editor = login("seed-editor-clinic");
        mockMvc.perform(get("/api/v1/content-types/owner/entries")
                        .header("Origin", BACK)
                        .cookie(editor.sessionCookie()))
                .andExpect(status().isForbidden());
        mockMvc.perform(get("/api/v1/public/content-types"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].key", hasItems("album", "vet", "clinic_profile", "project")))
                .andExpect(jsonPath("$.items[*].key", not(hasItem("owner"))))
                .andExpect(jsonPath("$.items[*].key", not(hasItem("issue"))));
    }

    @Test
    void tPc02CannotDeleteOwnerWithPet() throws Exception {
        Session op = login("seed-operator-clinic");
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String ownerId = createEntry(op, "owner", "del-" + suffix, """
                {"title":"Keep Pets"}
                """);
        createEntry(op, "pet", "keep-" + suffix, """
                {"title":"Kept","petType":"dog","owner":"%s"}
                """.formatted(ownerId));
        mockMvc.perform(delete("/api/v1/entries/" + ownerId)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("REF_CONSTRAINT"));
    }

    @Test
    void tPj01IssueStatusIsNotPublicationState() throws Exception {
        Session op = login("seed-operator-projects");
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String projectId = createEntry(op, "project", "harbor-" + suffix, """
                {"title":"Harbor Lights","summary":"A public harbour rebuild.","visibility":"public","lifecycle":"active"}
                """);
        String milestoneId = createEntry(op, "milestone", "m1-" + suffix, """
                {"title":"M1 Launch","project":"%s","status":"planned","sortOrder":10}
                """.formatted(projectId));
        String issueId = createEntry(op, "issue", "hull-" + suffix, """
                {"title":"Paint the hull","project":"%s","status":"backlog","sortOrder":10}
                """.formatted(projectId));
        mockMvc.perform(patch("/api/v1/entries/" + issueId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"status":"in_progress"}}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.status").value("in_progress"))
                .andExpect(jsonPath("$.publicationState").value("draft"));
        mockMvc.perform(post("/api/v1/entries/" + projectId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/entries/" + milestoneId + "/publish")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/project/entries"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].title", hasItem("Harbor Lights")))
                .andExpect(jsonPath("$.items[*].slug", hasItem("cms-scaffold")))
                .andExpect(jsonPath("$.items[*].slug", not(hasItem("internal-ops"))))
                .andExpect(jsonPath("$.items[*].slug", not(hasItem("draft-lab"))));
        MvcResult publicProject = mockMvc.perform(get("/api/v1/public/content-types/project/slugs/harbor-" + suffix))
                .andExpect(status().isOk())
                .andReturn();
        assertThat(publicProject.getResponse().getContentAsString()).doesNotContain("Paint the hull", "in_progress");
        mockMvc.perform(get("/api/v1/public/content-types/milestone/entries").param("ref.project", projectId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].title", hasItem("M1 Launch")));
        mockMvc.perform(get("/api/v1/public/content-types/issue/entries"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"))
                .andExpect(jsonPath("$.error.contentType").value("issue"));
        mockMvc.perform(get("/api/v1/public/content-types/project/slugs/draft-lab"))
                .andExpect(status().isNotFound());
        mockMvc.perform(get("/api/v1/public/content-types/project/slugs/internal-ops"))
                .andExpect(status().isNotFound());
        mockMvc.perform(post("/api/v1/boards")
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie()))
                .andExpect(status().isNotFound());
        Session editor = login("seed-editor-projects");
        mockMvc.perform(patch("/api/v1/entries/" + issueId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", editor.csrf)
                        .cookie(editor.sessionCookie(), editor.csrfCookie())
                        .content("""
                                {"payload":{"status":"done"}}
                                """))
                .andExpect(status().isForbidden());
    }

    @Test
    void tPj02UnknownIssueStatusIsUnprocessable() throws Exception {
        Session op = login("seed-operator-projects");
        MvcResult issues = mockMvc.perform(get("/api/v1/content-types/issue/entries")
                        .header("Origin", BACK)
                        .cookie(op.sessionCookie()))
                .andExpect(status().isOk())
                .andReturn();
        String issueId = idFromTitle(issues.getResponse().getContentAsString(), "Kanban DnD");
        mockMvc.perform(patch("/api/v1/entries/" + issueId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", op.csrf)
                        .cookie(op.sessionCookie(), op.csrfCookie())
                        .content("""
                                {"payload":{"status":"epic"}}
                                """))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"));
    }

    private String createEntry(Session session, String type, String slug, String payloadJson) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/v1/content-types/" + type + "/entries")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie())
                        .content("""
                                {"slug":"%s","payload":%s}
                                """.formatted(slug, payloadJson)))
                .andExpect(status().isCreated())
                .andReturn();
        return id(result);
    }

    private String uploadPng(Session session, String filename) throws Exception {
        MvcResult upload = mockMvc.perform(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", filename, "image/png", png()))
                        .header("Origin", BACK)
                        .header("X-CSRF-Token", session.csrf)
                        .cookie(session.sessionCookie(), session.csrfCookie()))
                .andExpect(status().isCreated())
                .andReturn();
        return id(upload);
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

    private static String id(MvcResult result) throws Exception {
        return result.getResponse().getContentAsString().replaceAll(".*\"id\":\"([^\"]+)\".*", "$1");
    }

    private static String idFromTitle(String body, String title) {
        return idBefore(body, "\"title\":\"" + title + "\"");
    }

    private static String idFromSlug(String body, String slug) {
        return idBefore(body, "\"slug\":\"" + slug + "\"");
    }

    private static String idBefore(String body, String marker) {
        int at = body.indexOf(marker);
        assertThat(at).isGreaterThanOrEqualTo(0);
        int idAt = body.lastIndexOf("\"id\":\"", at);
        assertThat(idAt).isGreaterThanOrEqualTo(0);
        return body.substring(idAt + 6, idAt + 42);
    }

    private static String cookie(MvcResult result, String name) {
        return result.getResponse().getHeaders("Set-Cookie").stream()
                .filter(v -> v.startsWith(name + "="))
                .map(v -> v.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElse(null);
    }

    private static byte[] png() throws Exception {
        BufferedImage image = new BufferedImage(32, 32, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(new Color(30, 90, 160));
        graphics.fillRect(0, 0, 32, 32);
        graphics.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(image, "png", out);
        return out.toByteArray();
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
