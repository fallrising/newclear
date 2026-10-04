package com.fallrising.cms;

import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.content.web.ContentStoreConfig;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.identity.web.IdentityStoreConfig;
import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaStore;
import com.fallrising.cms.media.web.MediaStoreConfig;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Close and recreate the actual Boot application against the same PostgreSQL database, then read over HTTP. */
@Testcontainers
class ApplicationPersistenceIntegrationTests {
    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine");
    static final String SEED = UUID.randomUUID().toString();

    @TempDir Path mediaRoot;

    @Test
    void storesRemainInMemoryWithoutADataSource() {
        new ApplicationContextRunner()
                .withUserConfiguration(IdentityStoreConfig.class, ContentStoreConfig.class, MediaStoreConfig.class)
                .withBean(ObjectMapper.class, ObjectMapper::new)
                .withPropertyValues("cms.media.root=" + mediaRoot)
                .run(context -> {
                    assertThat(context).hasNotFailed().doesNotHaveBean(DataSource.class);
                    assertThat(context.getBean(IdentityStore.class)).isInstanceOf(InMemoryIdentityStore.class);
                    assertThat(context.getBean(ContentStore.class)).isInstanceOf(InMemoryContentStore.class);
                    assertThat(context.getBean(MediaStore.class)).isInstanceOf(InMemoryMediaStore.class);
                });
    }

    @Test
    void publishedContentAndRetentionSurviveClosingAndRecreatingTheApplication() throws Exception {
        String id;
        String title = ApiFixture.token("Durable");
        JsonNode persistedWork;
        JsonNode persistedPublic;
        JsonNode persistedRetention;
        List<IndexRow> indexes;
        List<RevisionRecord> revisions;
        ContentStore firstStore;
        TestSession operator;
        TestSession admin;
        ConfigurableApplicationContext first = startApplication();
        try (first) {
            assertJdbcStores(first);
            MockMvc mvc = mvc(first);
            ObjectMapper mapper = first.getBean(ObjectMapper.class);
            ApiFixture api = new ApiFixture(mvc, mapper);
            operator = TestSession.login(mvc, "seed-operator-album", SEED, TestSession.BACK);
            id = api.create(operator, "album", Map.of("title", title)).get("id").asText();
            api.action(operator, id, "publish").andExpect(status().isOk())
                    .andExpect(jsonPath("$.publicationState").value("published"));
            persistedWork = api.work(operator, id);
            persistedPublic = api.json(mvc.perform(get("/api/v1/public/content-types/album/entries/{id}", id))
                    .andExpect(status().isOk()));
            firstStore = first.getBean(ContentStore.class);
            indexes = firstStore.indexRowsOf(UUID.fromString(id));
            revisions = firstStore.revisionsOf(UUID.fromString(id));
            assertThat(revisions).hasSize(1);
            assertThat(publishEvents(first, id)).isEqualTo(1);
            admin = TestSession.login(mvc, "seed-admin", SEED, TestSession.ADMIN);
            mvc.perform(admin.apply(patch("/api/v1/admin/settings/audit"))
                            .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.retentionDays").value(30));
            persistedRetention = api.json(mvc.perform(admin.apply(get("/api/v1/admin/settings/audit")))
                    .andExpect(status().isOk()));
            assertThat(persistedRetention.get("updatedBy").asText()).isEqualTo(
                    first.getBean(IdentityStore.class).findPrincipalByUsername("seed-admin").orElseThrow().id().toString());
            assertThat(retentionEvents(first)).isEqualTo(1);
        }
        assertThat(first.isActive()).isFalse();
        try (ConfigurableApplicationContext restarted = startApplication()) {
            assertJdbcStores(restarted);
            ContentStore store = restarted.getBean(ContentStore.class);
            assertThat(store).isNotSameAs(firstStore);
            MockMvc mvc = mvc(restarted);
            ApiFixture api = new ApiFixture(mvc, restarted.getBean(ObjectMapper.class));
            assertThat(api.work(operator, id)).isEqualTo(persistedWork);
            assertThat(api.json(mvc.perform(get("/api/v1/public/content-types/album/entries/{id}", id))
                    .andExpect(status().isOk()))).isEqualTo(persistedPublic);
            mvc.perform(get("/api/v1/public/content-types/album/entries").param("q", title))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1))
                    .andExpect(jsonPath("$.items[0].id").value(id));
            assertThat(store.indexRowsOf(UUID.fromString(id))).isEqualTo(indexes);
            assertThat(store.revisionsOf(UUID.fromString(id))).isEqualTo(revisions);
            assertThat(publishEvents(restarted, id)).isEqualTo(1);
            assertThat(api.json(mvc.perform(admin.apply(get("/api/v1/admin/settings/audit")))
                    .andExpect(status().isOk()))).isEqualTo(persistedRetention);
            assertThat(retentionEvents(restarted)).isEqualTo(1);
            assertThat(api.json(mvc.perform(admin.apply(patch("/api/v1/admin/settings/audit"))
                            .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"))
                    .andExpect(status().isOk()))).isEqualTo(persistedRetention);
            assertThat(retentionEvents(restarted)).isEqualTo(1);
        }
    }

    private ConfigurableApplicationContext startApplication() {
        return new SpringApplicationBuilder(CmsApiApplication.class).web(WebApplicationType.SERVLET).run(
                "--server.port=0", "--spring.autoconfigure.exclude=", "--spring.flyway.enabled=true",
                "--spring.datasource.url=" + POSTGRES.getJdbcUrl(),
                "--spring.datasource.username=" + POSTGRES.getUsername(),
                "--spring.datasource.password=" + POSTGRES.getPassword(),
                "--cms.identity.seed-password=" + SEED, "--cms.identity.argon2-memory-kb=8",
                "--cms.identity.argon2-iterations=1", "--cms.media.root=" + mediaRoot);
    }

    private static MockMvc mvc(ConfigurableApplicationContext context) {
        return MockMvcBuilders.webAppContextSetup((WebApplicationContext) context).apply(springSecurity()).build();
    }

    private static void assertJdbcStores(ConfigurableApplicationContext context) {
        assertThat(context.getBean(IdentityStore.class)).isInstanceOf(JdbcIdentityStore.class);
        assertThat(context.getBean(ContentStore.class)).isInstanceOf(JdbcContentStore.class);
        assertThat(context.getBean(MediaStore.class)).isInstanceOf(JdbcMediaStore.class);
    }

    private static long retentionEvents(ConfigurableApplicationContext context) {
        return new JdbcTemplate(context.getBean(DataSource.class)).queryForObject(
                "SELECT count(*) FROM cms_audit_event WHERE action = 'settings.retention_updated'", Long.class);
    }

    private static long publishEvents(ConfigurableApplicationContext context, String id) {
        return new JdbcTemplate(context.getBean(DataSource.class)).queryForObject(
                "SELECT count(*) FROM cms_audit_event WHERE target_id = ? AND action = 'entry.publish'", Long.class, UUID.fromString(id));
    }
}
