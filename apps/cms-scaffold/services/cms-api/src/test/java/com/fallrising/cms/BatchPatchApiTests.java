package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-09: POST /entries:batch-patch is all or nothing. */
@SpringBootTest
@AutoConfigureMockMvc
class BatchPatchApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;
    TestSession op;

    @BeforeEach
    void setUp() throws Exception {
        api = new ApiFixture(mockMvc, mapper);
        op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
    }

    @Test
    void G09_patchesEveryItemAndReturnsThemInOrder() throws Exception {
        String a = api.create(op, "album", Map.of("title", "A")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "B")).get("id").asText();
        batch(List.of(item(b, 1, Map.of("title", "B2")), item(a, 1, Map.of("title", "A2"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].id").value(equalTo(List.of(b, a))))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("B2", "A2"))))
                .andExpect(jsonPath("$.items[*].version").value(equalTo(List.of(2, 2))));
    }

    @Test
    void G09_fieldErrorsOfAllItemsNameTheItemAndNothingIsWritten() throws Exception {
        String a = api.create(op, "album", Map.of("title", "Keep A")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "Keep B")).get("id").asText();
        String c = api.create(op, "album", Map.of("title", "Keep C")).get("id").asText();
        batch(List.of(item(a, 1, Map.of("title", "Changed A")), item(b, 1, Map.of("visibility", "secret")),
                        item(c, 1, Map.of("sortMode", 7))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("items[1].payload.visibility", "items[2].payload.sortMode"))));
        mockMvc.perform(op.apply(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/entries/{id}", a)))
                .andExpect(jsonPath("$.title").value("Keep A"))
                .andExpect(jsonPath("$.version").value(1));
    }

    @Test
    void G09_firstFailingItemStopsTheBatch() throws Exception {
        String a = api.create(op, "album", Map.of("title", "First")).get("id").asText();
        String b = api.create(op, "album", Map.of("title", "Second")).get("id").asText();
        batch(List.of(item(a, 1, Map.of("title", "x")), item(b, 5, Map.of("title", "y"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"))
                .andExpect(jsonPath("$.error.message").value(startsWith("items[1]: ")));
        batch(List.of(item(UUID.randomUUID().toString(), 1, Map.of())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.message").value(startsWith("items[0]: ")));
        Map<String, Object> noVersion = new LinkedHashMap<>();
        noVersion.put("id", a);
        noVersion.put("payload", Map.of("title", "z"));
        batch(List.of(noVersion))
                .andExpect(status().isPreconditionRequired())
                .andExpect(jsonPath("$.error.code").value("VERSION_REQUIRED"));
        mockMvc.perform(op.apply(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/v1/entries/{id}", a)))
                .andExpect(jsonPath("$.title").value("First"));
    }

    @Test
    void G09_sizeAndIdRulesAndSurface() throws Exception {
        String a = api.create(op, "album", Map.of("title", "Limits")).get("id").asText();
        batch(List.of()).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        List<Map<String, Object>> tooMany = new ArrayList<>();
        for (int i = 0; i < 101; i++) tooMany.add(item(UUID.randomUUID().toString(), 1, Map.of()));
        batch(tooMany).andExpect(status().isBadRequest());
        batch(List.of(item(a, 1, Map.of()), item(a, 1, Map.of())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message").value("items[1].id is repeated"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(post("/api/v1/entries:batch-patch")).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("items", List.of(item(a, 1, Map.of()))))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }

    private static Map<String, Object> item(String id, int version, Map<String, Object> payload) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", id);
        item.put("version", version);
        item.put("payload", payload);
        return item;
    }

    private ResultActions batch(List<Map<String, Object>> items) throws Exception {
        return mockMvc.perform(op.apply(post("/api/v1/entries:batch-patch"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("items", items))));
    }
}
