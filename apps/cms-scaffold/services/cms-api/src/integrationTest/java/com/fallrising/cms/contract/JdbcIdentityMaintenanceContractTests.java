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
}
