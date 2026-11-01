package com.fallrising.cms;

import com.fallrising.cms.identity.domain.AuditRetention;
import com.fallrising.cms.identity.service.AuditPurgeJob;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.fallrising.cms.identity.domain.AuditEvent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** surface-admin §7.2 and 02 BQ-03: GET/PATCH /admin/settings/audit and the scheduled purge. */
@SpringBootTest
@AutoConfigureMockMvc
class AuditRetentionApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    IdentityStore identityStore;

    @Autowired
    ScheduledTaskHolder scheduledTasks;

    @Value("${cms.identity.seed-password}")
    String password;

    @AfterEach
    void restoreDefault() {
        identityStore.updateAuditRetention(new AuditRetention(AuditRetention.DEFAULT_DAYS, Instant.now(), null));
    }

    @Test
    void BW4_adminChangesRetentionAndTheChangeIsAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retentionDays").value(90))
                .andExpect(jsonPath("$.allowedDays").value(equalTo(List.of(30, 90, 365))))
                .andExpect(jsonPath("$.updatedBy").isEmpty());
        long before = retentionEvents(admin);

        String adminId = mapper.readTree(mockMvc.perform(admin.apply(get("/api/v1/auth/me")))
                .andReturn().getResponse().getContentAsString()).at("/principal/id").asText();
        retention(admin, "{\"retentionDays\":30}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.retentionDays").value(30))
                .andExpect(jsonPath("$.updatedBy").value(adminId));
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))).andExpect(jsonPath("$.retentionDays").value(30));
        assertThat(retentionEvents(admin)).isEqualTo(before + 1);

        JsonNode latest = json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit")
                .param("action", "settings.retention_updated").param("size", "1"))));
        assertThat(latest.at("/items/0/category").asText()).isEqualTo("SETTINGS");
        assertThat(latest.at("/items/0/targetType").asText()).isEqualTo("settings");
        assertThat(latest.at("/items/0/surface").asText()).isEqualTo("admin");
        assertThat(latest.at("/items/0/actor/username").asText()).isEqualTo("seed-admin");
        JsonNode detail = json(mockMvc.perform(admin.apply(
                get("/api/v1/admin/audit/{id}", latest.at("/items/0/id").asText()))));
        assertThat(detail.get("detail")).isEqualTo(mapper.readTree("{\"from\":90,\"to\":30}"));

        JsonNode beforeNoOp = json(mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))));
        JsonNode afterNoOp = json(retention(admin, "{\"retentionDays\":30}"));
        assertThat(afterNoOp).isEqualTo(beforeNoOp);
        assertThat(retentionEvents(admin)).isEqualTo(before + 1);
    }

    @Test
    void BW4_retentionOutsideThirtyNinetyOrThreeSixtyFiveIsRejected() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        retention(admin, "{\"retentionDays\":45}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andExpect(jsonPath("$.error.fields[0].field").value("retentionDays"))
                .andExpect(jsonPath("$.error.fields[0].code").value("NOT_IN_ENUM"));
        retention(admin, "{}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        retention(admin, "{\"retentionDays\":\"30\"}")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("WRONG_TYPE"));
        retention(admin, "{\"retentionDays\":30,\"purgeNow\":true}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))).andExpect(jsonPath("$.retentionDays").value(90));
    }

    @Test
    void BW4_invalidJsonTypesAndMissingValuesLeaveSettingsAndAuditUnchanged() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        JsonNode before = json(mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))));
        long events = retentionEvents(admin);
        for (String body : List.of("{}", "{\"retentionDays\":null}")) {
            retention(admin, body).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                    .andExpect(jsonPath("$.error.fields[0].field").value("retentionDays"))
                    .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        }
        for (String value : List.of("30.0", "true", "[]", "{}", "2147483648", "\"30\"")) {
            retention(admin, "{\"retentionDays\":" + value + "}")
                    .andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                    .andExpect(jsonPath("$.error.fields[0].code").value("WRONG_TYPE"));
        }
        for (String body : List.of("", "{", "null", "[]", "30", "true", "\"value\"")) {
            retention(admin, body).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(admin.apply(patch("/api/v1/admin/settings/audit")
                        .contentType(MediaType.TEXT_PLAIN).content("retentionDays=30")))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("MEDIA_TYPE_NOT_SUPPORTED"));
        assertThat(json(mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))))).isEqualTo(before);
        assertThat(retentionEvents(admin)).isEqualTo(events);
    }

    @Test
    void BW4_unauthenticatedSettingsRequestsAre401() throws Exception {
        mockMvc.perform(get("/api/v1/admin/settings/audit").header("Origin", TestSession.ADMIN))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        mockMvc.perform(patch("/api/v1/admin/settings/audit").header("Origin", TestSession.ADMIN)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
    }

    @Test
    void BW4_authorizationPrecedesObjectValidationAndEveryDenialIsAudited() throws Exception {
        for (String[] row : List.of(
                new String[]{"seed-admin", TestSession.FRONT, "SURFACE_FORBIDDEN"},
                new String[]{"seed-admin", TestSession.BACK, "SURFACE_FORBIDDEN"},
                new String[]{"seed-editor-clinic", TestSession.ADMIN, "FORBIDDEN"},
                new String[]{"seed-operator-album", TestSession.ADMIN, "FORBIDDEN"},
                new String[]{"seed-member-clinic", TestSession.ADMIN, "FORBIDDEN"})) {
            TestSession session = TestSession.login(mockMvc, row[0], password, row[1]);
            UUID actor = identityStore.findPrincipalByUsername(row[0]).orElseThrow().id();
            for (String body : List.of("{\"retentionDays\":\"bad\"}", "{\"unexpected\":true}")) {
                int before = identityStore.listAudits("manage_settings", null).size();
                retention(session, body).andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.error.code").value(row[2]));
                assertDenial(before, actor, row);
            }
            int before = identityStore.listAudits("manage_settings", null).size();
            mockMvc.perform(session.apply(get("/api/v1/admin/settings/audit")))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(row[2]));
            assertDenial(before, actor, row);
        }
        assertThat(identityStore.auditRetention().days()).isEqualTo(90);
    }

    private void assertDenial(int before, UUID actor, String[] row) throws Exception {
        List<AuditEvent> events = identityStore.listAudits("manage_settings", null);
        assertThat(events).hasSize(before + 1);
        AuditEvent event = events.getFirst();
        assertThat(event.actorPrincipalId()).isEqualTo(actor);
        assertThat(event.category()).isEqualTo("GOVERNANCE");
        assertThat(event.surface()).isEqualTo(row[1].equals(TestSession.FRONT) ? "front"
                : row[1].equals(TestSession.BACK) ? "back" : "admin");
        assertThat(event.outcome()).isEqualTo("denied");
        assertThat(event.targetType()).isNull();
        assertThat(event.targetId()).isNull();
        assertThat(mapper.readTree(event.detailJson()).get("reason").asText()).isEqualTo(row[2]);
    }

    @Test
    void BW4_purgeRunsDailyStartingAnHourAfterStartup() {
        List<FixedDelayTask> purge = scheduledTasks.getScheduledTasks().stream()
                .map(t -> t.getTask())
                .filter(t -> t instanceof FixedDelayTask)
                .map(t -> (FixedDelayTask) t)
                .filter(t -> t.getRunnable().toString().equals(AuditPurgeJob.class.getName() + ".run"))
                .toList();
        assertThat(purge).hasSize(1);
        assertThat(purge.get(0).getIntervalDuration()).isEqualTo(Duration.ofHours(24));
        assertThat(purge.get(0).getInitialDelayDuration()).isEqualTo(Duration.ofHours(1));
    }

    private ResultActions retention(TestSession session, String body) throws Exception {
        return mockMvc.perform(session.apply(patch("/api/v1/admin/settings/audit")
                .contentType(MediaType.APPLICATION_JSON).content(body)));
    }

    private long retentionEvents(TestSession admin) throws Exception {
        return json(mockMvc.perform(admin.apply(get("/api/v1/admin/audit").param("action", "settings.retention_updated"))))
                .get("total").asLong();
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
}
