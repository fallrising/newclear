package com.fallrising.cms;

import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.SoftAssertions.assertSoftly;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Full application JDBC wiring and PostgreSQL failures at the audit write boundary. */
@SpringBootTest(properties = {"spring.autoconfigure.exclude=", "spring.flyway.enabled=true",
        "cms.identity.argon2-memory-kb=8", "cms.identity.argon2-iterations=1"})
@AutoConfigureMockMvc
@Testcontainers
class AuditRollbackIntegrationTests {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    static final String SEED = UUID.randomUUID().toString();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        registry.add("cms.identity.seed-password", () -> SEED);
        registry.add("cms.media.root", () -> "./build/t902-rollback-media");
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
    }

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper mapper;
    @Autowired DataSource dataSource;
    @Autowired IdentityStore identityStore;
    @Autowired ContentStore contentStore;
    @Autowired MediaStore mediaStore;

    @Test
    void BW4_applicationWithADataSourceUsesTheJdbcStores() {
        assertSoftly(soft -> {
            soft.assertThat(identityStore).isInstanceOf(JdbcIdentityStore.class);
            soft.assertThat(contentStore).isInstanceOf(JdbcContentStore.class);
            soft.assertThat(mediaStore).isInstanceOf(JdbcMediaStore.class);
        });
    }

    @Test
    void BW4_migrationDefaultsAndChecksProtectTheRetentionRow() {
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Map<String, Object> before = jdbc.queryForMap("SELECT * FROM cms_audit_settings WHERE id = 1");
        assertThat(before.get("retention_days")).isEqualTo(90);
        assertThat(before.get("updated_by")).isNull();
        assertThatThrownBy(() -> jdbc.update("UPDATE cms_audit_settings SET retention_days = 45 WHERE id = 1"))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("check constraint");
        assertThatThrownBy(() -> jdbc.update("INSERT INTO cms_audit_settings (id, retention_days) VALUES (2, 90)"))
                .isInstanceOf(DataIntegrityViolationException.class).hasMessageContaining("check constraint");
        assertThat(jdbc.queryForMap("SELECT * FROM cms_audit_settings WHERE id = 1")).isEqualTo(before);
        assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_settings")).isOne();
    }

    @Test
    void BQ12_failedAuditInsertRollsBackThePublish() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession operator = TestSession.login(mockMvc, "seed-operator-album", SEED, TestSession.BACK);
        String id = api.create(operator, "album", Map.of("title", ApiFixture.token("Rollback"))).get("id").asText();
        api.action(operator, id, "publish-request").andExpect(status().isOk());
        UUID entryId = UUID.fromString(id);
        EntryRecord before = contentStore.findEntry(entryId).orElseThrow();
        var revisions = contentStore.revisionsOf(entryId);
        var index = contentStore.indexRowsOf(entryId);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        long auditCount = count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE target_id = ?", entryId);
        assertThat(count(jdbc, "SELECT count(*) FROM cms_entry WHERE id = ? AND publication_state = 'draft'", entryId)).isOne();

        failAuditInsert(jdbc, "entry.publish");
        try {
            api.action(operator, id, "publish").andExpect(status().isInternalServerError())
                    .andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"));
            assertThat(contentStore.findEntry(entryId)).contains(before);
            assertThat(contentStore.revisionsOf(entryId)).isEqualTo(revisions);
            assertThat(contentStore.indexRowsOf(entryId)).isEqualTo(index);
            assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE target_id = ?", entryId)).isEqualTo(auditCount);
            assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE target_id = ? AND action = 'entry.publish'", entryId)).isZero();
            assertThat(count(jdbc, "SELECT count(*) FROM cms_entry WHERE id = ? AND publication_state = 'draft' AND version = ?",
                    entryId, before.version())).isOne();
            mockMvc.perform(get("/api/v1/public/content-types/album/entries/{id}", id)).andExpect(status().isNotFound());
        } finally {
            restoreAuditInsert(jdbc);
        }
        api.action(operator, id, "publish").andExpect(status().isOk())
                .andExpect(jsonPath("$.publicationState").value("published"))
                .andExpect(jsonPath("$.version").value(before.version() + 1));
        assertThat(contentStore.revisionsOf(entryId)).hasSize(revisions.size() + 1);
        assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE target_id = ? AND action = 'entry.publish'", entryId)).isOne();
    }

    @Test
    void failedAuditInsertRollsBackRetentionAndItsMetadata() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", SEED, TestSession.ADMIN);
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        var before = identityStore.auditRetention();
        var row = jdbc.queryForMap("SELECT * FROM cms_audit_settings WHERE id = 1");
        var beforeJson = api.json(mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit"))).andExpect(status().isOk()));
        long events = count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE action = 'settings.retention_updated'");
        try {
            failAuditInsert(jdbc, "settings.retention_updated");
            try {
                mockMvc.perform(admin.apply(patch("/api/v1/admin/settings/audit"))
                                .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"))
                        .andExpect(status().isInternalServerError()).andExpect(jsonPath("$.error.code").value("INTERNAL_ERROR"));
                assertThat(identityStore.auditRetention()).isEqualTo(before);
                assertThat(jdbc.queryForMap("SELECT * FROM cms_audit_settings WHERE id = 1")).isEqualTo(row);
                assertThat(api.json(mockMvc.perform(admin.apply(get("/api/v1/admin/settings/audit")))
                        .andExpect(status().isOk()))).isEqualTo(beforeJson);
                assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE action = 'settings.retention_updated'")).isEqualTo(events);
            } finally {
                restoreAuditInsert(jdbc);
            }
            mockMvc.perform(admin.apply(patch("/api/v1/admin/settings/audit"))
                            .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.retentionDays").value(30));
            assertThat(identityStore.auditRetention().days()).isEqualTo(30);
            assertThat(identityStore.auditRetention().updatedBy()).isEqualTo(identityStore.findPrincipalByUsername("seed-admin").orElseThrow().id());
            assertThat(count(jdbc, "SELECT count(*) FROM cms_audit_event WHERE action = 'settings.retention_updated'")).isEqualTo(events + 1);
        } finally {
            identityStore.updateAuditRetention(before);
        }
    }

    /** A trigger changes the real audit insert to violate the actor FK; no service/store mocks are involved. */
    private static void failAuditInsert(JdbcTemplate jdbc, String action) {
        UUID missingPrincipal = UUID.randomUUID();
        jdbc.execute("""
                CREATE FUNCTION t902_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.action = '%s' THEN NEW.actor_principal_id = '%s'::uuid; END IF;
                    RETURN NEW;
                END; $$
                """.formatted(action, missingPrincipal));
        jdbc.execute("CREATE TRIGGER t902_reject_audit BEFORE INSERT ON cms_audit_event FOR EACH ROW EXECUTE FUNCTION t902_reject_audit()");
    }

    private static void restoreAuditInsert(JdbcTemplate jdbc) {
        jdbc.execute("DROP TRIGGER IF EXISTS t902_reject_audit ON cms_audit_event");
        jdbc.execute("DROP FUNCTION IF EXISTS t902_reject_audit()");
    }

    private static long count(JdbcTemplate jdbc, String sql, Object... args) {
        return jdbc.queryForObject(sql, Long.class, args);
    }

}
