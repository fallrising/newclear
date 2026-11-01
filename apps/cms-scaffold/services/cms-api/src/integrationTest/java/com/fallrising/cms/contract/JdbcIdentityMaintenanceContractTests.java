package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.sql.DataSource;
import java.util.LinkedHashMap;

class JdbcIdentityMaintenanceContractTests extends IdentityMaintenanceContract {
    protected DataSource source;
    @Override protected IdentityStore newStore() {
        source = PostgresFixture.cleanDataSource();
        transactions = new TransactionRunner(source);
        return new JdbcIdentityStore(source, new TransactionTemplate(new DataSourceTransactionManager(source))) {
            @Override public void upsertPasswordCredential(java.util.UUID id, String hash, String algo) {
                super.upsertPasswordCredential(id, hash, algo); afterWrite("credential");
            }
            @Override public void replacePrincipalRoles(java.util.UUID id, java.util.List<com.fallrising.cms.identity.domain.PrincipalRoleAssignment> roles) {
                super.replacePrincipalRoles(id, roles); afterWrite("assignment");
            }
            @Override public com.fallrising.cms.identity.domain.Principal updatePrincipal(com.fallrising.cms.identity.domain.Principal p) {
                var result = super.updatePrincipal(p); afterWrite("principal"); return result;
            }
            @Override public void revokeAllForPrincipal(java.util.UUID id, java.time.Instant at, java.util.UUID except) {
                super.revokeAllForPrincipal(id, at, except); afterWrite("revoke");
            }
            @Override public void insertAudit(com.fallrising.cms.identity.domain.AuditEvent event) {
                super.insertAudit(event); afterWrite("audit");
            }
        };
    }
    @Override protected void removePasswordFixture(java.util.UUID principalId) {
        new JdbcTemplate(source).update("DELETE FROM cms_credential WHERE principal_id = ? AND type = 'password'", principalId);
    }
    @Override protected Object snapshot() {
        var jdbc = new JdbcTemplate(source);
        var rows = new LinkedHashMap<String, String>();
        for (String table : new String[]{"cms_principal", "cms_credential", "cms_role", "cms_principal_role",
                "cms_permission", "cms_session", "cms_audit_event"})
            rows.put(table, jdbc.queryForObject("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM " + table + " t", String.class));
        return rows;
    }

    @org.junit.jupiter.api.Test
    @Override void PP1FM04_primitiveGuardSerializesOrTimesOut() throws Exception {
        super.PP1FM04_primitiveGuardSerializesOrTimesOut();
        Object before = snapshot();
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        try (var connection = source.getConnection(); var statement = connection.createStatement()) {
            connection.setAutoCommit(false);
            statement.execute("SELECT pg_advisory_xact_lock(" + 0x434d5341444d494eL + ")");
            var blocked = executor.submit(() -> {
                try { store.maintenanceTransaction(() -> { store.insertPrincipal(principal("blocked.fixture", false)); return null; }); return 0; }
                catch (com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.Failure failure) { return failure.code().exitCode(); }
            });
            org.assertj.core.api.Assertions.assertThat(blocked.get(7, java.util.concurrent.TimeUnit.SECONDS)).isEqualTo(4);
            org.assertj.core.api.Assertions.assertThat(snapshot()).isEqualTo(before);
            connection.rollback();
        } finally { executor.shutdownNow(); }
    }

    @org.junit.jupiter.api.Test
    @org.junit.jupiter.api.Timeout(90)
    void PP1AC02_productionContextValidatesOnTheSingleBoundBackendAndRejectsDrift() throws Exception {
        try (var postgres = new org.testcontainers.containers.PostgreSQLContainer<>("postgres:16-alpine")
                .withDatabaseName("cms").withUsername("cms_local").withPassword(java.util.UUID.randomUUID().toString())) {
            postgres.start();
            var observer = new org.postgresql.ds.PGSimpleDataSource();
            observer.setURL(postgres.getJdbcUrl()); observer.setUser(postgres.getUsername()); observer.setPassword(postgres.getPassword());
            org.flywaydb.core.Flyway.configure().dataSource(observer).locations("classpath:db/migration").load().migrate();
            var operation = java.util.UUID.randomUUID();
            var options = new com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.Options(
                    com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.Operation.FRESH_INIT,
                    "context.fixture", "Context fixture", null, "fixture", operation, false);
            var guard = org.mockito.Mockito.mock(com.fallrising.cms.identity.maintenance.MaintenanceGuard.class);
            var phase = org.mockito.Mockito.mock(com.fallrising.cms.identity.maintenance.MaintenanceGuard.ConnectionPhase.class);
            org.mockito.Mockito.when(guard.connectionPhase()).thenReturn(phase);
            var values = java.util.Map.ofEntries(
                    java.util.Map.entry("CMS_RUNTIME_PRODUCTION_REQUIRED", "true"),
                    java.util.Map.entry("CMS_SITE_DOMAIN", "cms.test"),
                    java.util.Map.entry("CMS_API_ORIGIN", "https://api.cms.test:8443"),
                    java.util.Map.entry("CMS_CORS_ORIGINS", "https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443"),
                    java.util.Map.entry("CMS_SURFACE_ORIGINS", "https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin"),
                    java.util.Map.entry("CMS_IDENTITY_SEED_ENABLED", "false"),
                    java.util.Map.entry("CMS_IDENTITY_COOKIE_SECURE", "true"),
                    java.util.Map.entry("CMS_MEDIA_ROOT", "/data/media"),
                    java.util.Map.entry("SPRING_DATASOURCE_URL", postgres.getJdbcUrl().split("\\?", 2)[0]),
                    java.util.Map.entry("SPRING_DATASOURCE_USERNAME", postgres.getUsername()),
                    java.util.Map.entry("SPRING_DATASOURCE_PASSWORD", postgres.getPassword()));
            var previous = new java.util.HashMap<String, String>();
            values.forEach((key, value) -> previous.put(key, System.getProperty(key)));
            try {
                values.forEach(System::setProperty);
                try (var context = com.fallrising.cms.identity.maintenance.IdentityMaintenanceConfiguration.open(options, guard)) {
                    var pool = (com.zaxxer.hikari.HikariDataSource) context.getBean(javax.sql.DataSource.class);
                    org.assertj.core.api.Assertions.assertThat(pool.getMaximumPoolSize()).isEqualTo(1);
                    try (var connection = pool.getConnection(); var statement = connection.createStatement();
                         var row = statement.executeQuery("SELECT pid, extract(epoch FROM backend_start)::text FROM pg_stat_activity WHERE pid=pg_backend_pid()")) {
                        org.assertj.core.api.Assertions.assertThat(row.next()).isTrue();
                        org.mockito.Mockito.verify(phase).bindBackend(row.getInt(1), row.getString(2));
                    }
                    org.assertj.core.api.Assertions.assertThat(new JdbcTemplate(observer).queryForObject(
                            "SELECT count(*) FROM pg_stat_activity WHERE application_name=?", Integer.class, operation.toString())).isEqualTo(1);
                    org.assertj.core.api.Assertions.assertThat(new JdbcTemplate(observer).queryForObject(
                            "SELECT count(*) FROM cms_principal", Integer.class)).isZero();
                }
                org.assertj.core.api.Assertions.assertThat(new JdbcTemplate(observer).queryForObject(
                        "SELECT count(*) FROM pg_stat_activity WHERE application_name=?", Integer.class, operation.toString())).isZero();
                new JdbcTemplate(observer).update("UPDATE flyway_schema_history SET checksum=checksum+1 WHERE version='1'");
                org.assertj.core.api.Assertions.assertThatThrownBy(() ->
                        com.fallrising.cms.identity.maintenance.IdentityMaintenanceConfiguration.open(options, guard))
                        .isInstanceOf(com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.Failure.class)
                        .hasMessage("MAINTENANCE_INTERNAL_ERROR").hasNoCause();
                org.assertj.core.api.Assertions.assertThat(new JdbcTemplate(observer).queryForObject(
                        "SELECT count(*) FROM pg_stat_activity WHERE application_name=?", Integer.class, operation.toString())).isZero();
            } finally {
                previous.forEach((key, value) -> { if (value == null) System.clearProperty(key); else System.setProperty(key, value); });
            }
        }
    }

}
