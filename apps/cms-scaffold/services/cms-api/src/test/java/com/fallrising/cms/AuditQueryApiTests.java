package com.fallrising.cms;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.store.IdentityStore;
import java.time.Instant;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** B-07: GET /admin/audit search and GET /admin/audit/{id} (02 §4.6). */
@SpringBootTest
@AutoConfigureMockMvc
class AuditQueryApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Autowired IdentityStore identity;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void B07_searchFiltersByTargetActorActionAndPages() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Audit search")).get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);

        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetType", "entry").param("targetId", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.items[*].action").value(equalTo(List.of("entry.publish", "entry.create"))))
                .andExpect(jsonPath("$.items[0].actor.username").value("seed-operator-album"))
                .andExpect(jsonPath("$.items[0].actor.displayName").value("Album operator"))
                .andExpect(jsonPath("$.items[0].category").value("CONTENT"))
                .andExpect(jsonPath("$.items[0].surface").value("back"))
                .andExpect(jsonPath("$.items[0].outcome").value("ok"));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("page", "2").param("size", "1")))
                .andExpect(jsonPath("$.total").value(2))
                .andExpect(jsonPath("$.offset").value(1))
                .andExpect(jsonPath("$.items[*].action").value(equalTo(List.of("entry.create"))));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("action", "entry.")))
                .andExpect(jsonPath("$.total").value(2));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("action", "entry")))
                .andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("actor", "seed-operator-album")))
                .andExpect(jsonPath("$.total").value(2));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("actor", "nobody-here")))
                .andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("targetId", id).param("from", "2999-01-01T00:00:00Z")))
                .andExpect(jsonPath("$.total").value(0));
    }

    @Test
    void B07_oneEventCarriesItsDetail() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = api.create(op, "album", Map.of("title", "Audit detail")).get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        JsonNode page = api.json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit")
                .param("targetId", id).param("action", "entry.publish"))));
        String eventId = page.get("items").get(0).get("id").asText();
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", eventId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.action").value("entry.publish"))
                .andExpect(jsonPath("$.detail.revisionNo").value(1));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", UUID.randomUUID())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("AUDIT_EVENT_NOT_FOUND"));
    }

    @Test
    void B07_invalidParametersAre400AndBackIsForbidden() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        for (String[] bad : List.of(new String[] {"size", "0"}, new String[] {"from", "yesterday"},
                new String[] {"targetId", "x"}, new String[] {"page", "-1"})) {
            mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param(bad[0], bad[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/admin/audit")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }
    @Test
    void B07_unknownActorStillValidatesEveryParameterAndOffsetsUseLong() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("actor", "unknown-actor")
                        .param("targetId", "not-a-uuid")))
                .andExpect(status().isBadRequest());
        for (String name : List.of("page", "size", "from", "to", "actor", "action", "category", "targetType", "targetId", "outcome")) {
            mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param(name, "", "")))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.message").value(name + " must not repeat"));
        }
        for (String[] bad : List.of(new String[]{"page", "+1"}, new String[]{"page", "１"}, new String[]{"targetId", "1-1-1-1-1"})) {
            mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param(bad[0], bad[1])))
                    .andExpect(status().isBadRequest());
        }
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("actor", "unknown-actor")
                        .param("page", "2147483647").param("size", "100").param("ignored", "a", "b")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.offset").value(214748364600L))
                .andExpect(jsonPath("$.total").value(0))
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void B07_deletedActorIsNullableAndAnonymousActorStaysNull() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        UUID absent = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        identity.insertAudit(new AuditEvent(eventId, Instant.now(), absent, "AUTH", "legacy.event", null, null,
                "admin", "ok", null, null));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", eventId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actor.id").value(absent.toString()))
                .andExpect(jsonPath("$.actor.username").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.actor.displayName").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.nullValue()));
        UUID anonymous = UUID.randomUUID();
        identity.insertAudit(new AuditEvent(anonymous, Instant.now(), null, "AUTH", "legacy.event", null, null,
                null, "ok", null, "[]"));
        mockMvc.perform(admin.apply(get("/api/v1/admin/audit/{id}", anonymous)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.actor").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.nullValue()));
    }

}
