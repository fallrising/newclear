package com.fallrising.cms.contract;

import com.fallrising.cms.ops.RestoreSessionRevoker;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import javax.sql.DataSource;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class RestoreSessionRevokerIntegrationTests {
    static final UUID OP = UUID.fromString("00112233-4455-6677-8899-aabbccddeeff");
    static final String BACKUP = "pp1-20261102T142500000Z-" + "a".repeat(32);
    static final String TARGET = "pp1-local:" + "b".repeat(32);
    DataSource source;
    JdbcTemplate jdbc;

    @BeforeEach void setup() {
        source = PostgresFixture.cleanDataSource();
        jdbc = new JdbcTemplate(source);
        jdbc.update("INSERT INTO cms_principal(id,username,display_name,status) VALUES (?,'restored','Restored','active')", OP);
    }
    void seed() {
        for (int n = 1; n <= 3; n++) {
            jdbc.update("INSERT INTO cms_session(id,principal_id,token_hash,expires_at,revoked_at,created_surface) "
                    + "VALUES (?,?,?,now()+interval '1 day',?::timestamptz,'admin')", UUID.randomUUID(), OP,
                    new byte[]{(byte)n}, n == 3 ? "2020-01-01T00:00:00Z" : null);
        }
    }
    Map<String, String> unchanged() {
        Map<String, String> tables = new TreeMap<>();
        for (String table : jdbc.queryForList("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name", String.class)) {
            if (!table.equals("cms_session") && !table.equals("cms_audit_event")) {
                tables.put(table, jdbc.queryForObject("SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM \"" + table + "\" t", String.class));
            }
        }
        assertEquals(18, tables.size());
        return tables;
    }
    Map<String, Object> execute(Connection c) throws Exception {
        c.setAutoCommit(false);
        return RestoreSessionRevoker.revoke(c, OP, BACKUP, TARGET);
    }
    @Test void PP1c_revokeAllAndExactlyOneAuditLeavesOtherTablesUnchanged() throws Exception {
        seed(); var before = unchanged();
        Map<String, Object> receipt;
        try (var c = source.getConnection()) { receipt = execute(c); }
        assertEquals(Map.of("operationId", OP.toString(), "backupId", BACKUP, "revokedCount", "2",
                "auditEventId", receipt.get("auditEventId"), "committed", true), receipt);
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cms_session WHERE revoked_at IS NULL", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(DISTINCT revoked_at) FROM cms_session WHERE revoked_at > '2021-01-01'", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cms_session WHERE revoked_at='2020-01-01'", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Integer.class));
        var audit = jdbc.queryForMap("SELECT * FROM cms_audit_event");
        assertEquals(receipt.get("auditEventId"), audit.get("id").toString());
        assertEquals("AUTH", audit.get("category"));
        assertEquals("PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE", audit.get("action"));
        assertEquals("restore", audit.get("target_type"));
        assertEquals("admin", audit.get("surface")); assertEquals("ok", audit.get("outcome"));
        assertNull(audit.get("actor_principal_id")); assertNull(audit.get("target_id")); assertNull(audit.get("ip"));
        assertEquals(Map.of("operationId", OP.toString(), "backupId", BACKUP, "targetRef", TARGET, "revokedCount", "2"),
                new ObjectMapper().readValue(audit.get("detail_json").toString(), Map.class));
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cms_session s,cms_audit_event a WHERE s.revoked_at=a.at", Integer.class));
        assertEquals(before, unchanged());
    }
    @Test void PP1c_zeroSessionsStillCommitsExactlyOneAudit() throws Exception {
        try (var c = source.getConnection()) { assertEquals("0", execute(c).get("revokedCount")); }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Integer.class));
    }
    void failInsert(String table) {
        jdbc.execute("CREATE FUNCTION reject_revoke() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$");
        jdbc.execute("CREATE TRIGGER reject_revoke BEFORE INSERT OR UPDATE ON " + table + " FOR EACH ROW EXECUTE FUNCTION reject_revoke()");
    }
    void assertRolledBack() {
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM cms_session WHERE revoked_at IS NULL", Integer.class));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Integer.class));
    }
    @Test void PP1c_auditFailureRollsBackAllSessionUpdates() throws Exception {
        seed(); failInsert("cms_audit_event"); var before = unchanged();
        try (var c = source.getConnection()) { assertThrows(Exception.class, () -> execute(c)); }
        assertRolledBack(); assertEquals(before, unchanged());
    }
    @Test void PP1c_updateFailureRollsBackWithoutAudit() throws Exception {
        seed(); failInsert("cms_session");
        try (var c = source.getConnection()) { assertThrows(Exception.class, () -> execute(c)); }
        assertRolledBack();
    }
    Connection wrapped(Connection actual, boolean unknownCommit, AtomicInteger rollbacks) {
        var checks = new AtomicInteger();
        return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{Connection.class}, (p,m,a) -> {
            if (m.getName().equals("rollback")) rollbacks.incrementAndGet();
            if (!unknownCommit && m.getName().equals("getAutoCommit") && checks.incrementAndGet() == 2) throw new SQLException("precommit failure");
            try {
                Object result = m.invoke(actual, a);
                if (unknownCommit && m.getName().equals("commit")) throw new SQLException("response lost after commit");
                return result;
            } catch (InvocationTargetException failure) { throw failure.getCause(); }
        });
    }
    @Test void PP1c_precommitFailureRollsBackAuditAndSessions() throws Exception {
        seed(); var rollbacks = new AtomicInteger();
        try (var c = source.getConnection()) { assertThrows(Exception.class, () -> execute(wrapped(c, false, rollbacks))); }
        assertEquals(1, rollbacks.get()); assertRolledBack();
    }
    @Test void PP1c_unknownCommitNeverRollsBackOrRetries() throws Exception {
        seed(); var rollbacks = new AtomicInteger();
        try (var c = source.getConnection()) { assertThrows(Exception.class, () -> execute(wrapped(c, true, rollbacks))); }
        assertEquals(0, rollbacks.get());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM cms_session WHERE revoked_at IS NULL", Integer.class));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Integer.class));
    }
}
