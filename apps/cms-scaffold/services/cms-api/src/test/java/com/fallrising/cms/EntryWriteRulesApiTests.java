package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** BW1c: field errors (B-06, BD-08), PATCH version (02 §4.4), clearing with null (G-07), public media null (B-13). */
@SpringBootTest
@AutoConfigureMockMvc
class EntryWriteRulesApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B06_createReturnsEveryFieldErrorAtOnce() throws Exception {
        TestSession op = operator();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("slug", "inside-payload");
        payload.put("title", "t".repeat(1_001));
        payload.put("cover", "not-a-uuid");
        payload.put("visibility", "secret");
        payload.put("sortMode", 5);
        create(op, "album", payload)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.message").value("5 invalid field(s); first: Reserved field: slug"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of(
                        "payload.slug", "payload.title", "payload.cover", "payload.visibility", "payload.sortMode"))))
                .andExpect(jsonPath("$.error.fields[*].code").value(equalTo(List.of(
                        "RESERVED_KEY", "TOO_LONG", "INVALID_UUID", "NOT_IN_ENUM", "WRONG_TYPE"))));
    }

    @Test
    void B06_firstReferenceErrorKeepsItsV1Code() throws Exception {
        TestSession op = operator();
        create(op, "photo", Map.of("album", UUID.randomUUID().toString(), "takenAt", "yesterday"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("REF_TARGET_NOT_FOUND"))
                .andExpect(jsonPath("$.error.fields[*].code").value(equalTo(List.of("REF_TARGET_NOT_FOUND", "INVALID_DATETIME"))));
    }

    @Test
    void B06_publishListsEveryMissingRequiredField() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "photo", Map.of("caption", "no album yet")).andExpect(status().isCreated()));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.album"))))
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
    }

    @Test
    void BW1c_patchWithoutVersionIsPreconditionRequired() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "album", Map.of("title", "Versioned")).andExpect(status().isCreated()));
        for (String body : List.of("{\"payload\":{\"title\":{}}}", "{\"version\":null,\"payload\":{\"title\":{}}}")) {
            mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isPreconditionRequired())
                    .andExpect(jsonPath("$.error.code").value("VERSION_REQUIRED"))
                    .andExpect(jsonPath("$.error.message").value("PATCH requires the entry version"))
                    .andExpect(jsonPath("$.error.fields").doesNotExist());
            mockMvc.perform(op.apply(get("/api/v1/entries/{id}", id)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.version").value(1))
                    .andExpect(jsonPath("$.payload.title").value("Versioned"));
        }
        patchEntry(op, id, 1, Map.of("title", "Now versioned"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2));
        patchEntry(op, id, 1, Map.of("title", "t".repeat(1_001)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.fields").doesNotExist());
        mockMvc.perform(op.apply(get("/api/v1/entries/{id}", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.payload.title").value("Now versioned"));
    }

    @Test
    void BW1c_sessionSurfaceExistenceAndPermissionAreCheckedBeforeVersion() throws Exception {
        TestSession op = operator();
        String id = id(create(op, "album", Map.of("title", "Guarded")).andExpect(status().isCreated()));
        String noVersion = "{\"payload\":{\"title\":\"x\"}}";
        mockMvc.perform(patch("/api/v1/entries/{id}", id).header("Origin", TestSession.BACK)
                        .contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", UUID.randomUUID())).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        TestSession clinicEditor = TestSession.login(mockMvc, "seed-editor-clinic", password, TestSession.BACK);
        mockMvc.perform(clinicEditor.apply(patch("/api/v1/entries/{id}", id)).contentType(MediaType.APPLICATION_JSON).content(noVersion))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void G07_nullClearsAFieldWithoutValidationAndPublishStillChecksRequired() throws Exception {
        TestSession op = operator();
        String slug = token();
        String id = id(create(op, "album", Map.of("title", "Clear me", "description", "Some text", "visibility", "public"), slug)
                .andExpect(status().isCreated()));
        Map<String, Object> clear = new LinkedHashMap<>();
        clear.put("description", null);
        clear.put("title", null);
        patchEntry(op, id, 1, clear)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("description")))
                .andExpect(jsonPath("$.payload.description").value(nullValue()))
                .andExpect(jsonPath("$.payload.visibility").value("public"));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.title"))));
        patchEntry(op, id, 2, Map.of("title", "Filled again")).andExpect(status().isOk());
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", slug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("description")))
                .andExpect(jsonPath("$.payload.description").value(nullValue()));
    }

    @Test
    void B13_unreadableMediaIsNullAndReadableMediaIsExpanded() throws Exception {
        TestSession op = operator();
        String media = upload(op);
        String hiddenSlug = token();
        String shownSlug = token();
        String hiddenTitle = "Hidden cover " + token();
        String hiddenId = id(create(op, "album", Map.of("title", hiddenTitle, "visibility", "public",
                "cover", UUID.randomUUID().toString()), hiddenSlug).andExpect(status().isCreated()));
        publish(op, hiddenId);
        publish(op, id(create(op, "album", Map.of("title", "Shown cover", "visibility", "public", "cover", media), shownSlug)
                .andExpect(status().isCreated())));

        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", hiddenSlug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("cover")))
                .andExpect(jsonPath("$.payload.cover").value(nullValue()));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("q", hiddenTitle))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].payload").value(hasKey("cover")))
                .andExpect(jsonPath("$.items[0].payload.cover").value(nullValue()));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/{id}", hiddenId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload").value(hasKey("cover")))
                .andExpect(jsonPath("$.payload.cover").value(nullValue()));
        mockMvc.perform(get("/api/v1/public/content-types/album/slugs/{slug}", shownSlug))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.payload.cover.mediaId").value(media));
    }

    private TestSession operator() throws Exception {
        return TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
    }

    private ResultActions create(TestSession op, String type, Map<String, Object> payload) throws Exception {
        return create(op, type, payload, token());
    }

    private ResultActions create(TestSession op, String type, Map<String, Object> payload, String slug) throws Exception {
        return mockMvc.perform(op.apply(post("/api/v1/content-types/{type}/entries", type))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("slug", slug, "payload", payload))));
    }

    private ResultActions patchEntry(TestSession op, String id, int version, Map<String, Object> payload) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("payload", payload);
        return mockMvc.perform(op.apply(patch("/api/v1/entries/{id}", id))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    private void publish(TestSession op, String id) throws Exception {
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
    }

    private String upload(TestSession op) throws Exception {
        BufferedImage image = new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        return id(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "cover.png", "image/png", png.toByteArray()))))
                .andExpect(status().isCreated()));
    }

    private String id(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString()).get("id").asText();
    }

    private static String token() {
        return "w" + UUID.randomUUID().toString().substring(0, 8);
    }
}
