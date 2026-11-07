package com.fallrising.cms.contract;

import com.fallrising.cms.ops.RecoveryInventory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class RecoveryInventoryIntegrationTests {
    @TempDir Path media;

    @Test void PP1c_fixedTwentyTablesNullablePostgresTextAndReadonly() throws Exception {
        var source = PostgresFixture.cleanDataSource();
        try (var c = source.getConnection(); var s = c.createStatement()) {
            s.execute("""
                    INSERT INTO cms_principal(id,username,display_name,status,created_at)
                    VALUES ('10000000-0000-0000-0000-000000000001','fixture','Fixture','active',
                    '2026-01-02 03:04:05.123456+08');
                    INSERT INTO cms_role(id,code,display_name) VALUES
                    ('20000000-0000-0000-0000-000000000001','fixture','Fixture');
                    INSERT INTO cms_permission(id,role_id,action,predicate_json,allowed_surfaces) VALUES
                    ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
                    'read','{"number":9007199254740993}',ARRAY['back','comma,value']);
                    INSERT INTO cms_session(id,principal_id,token_hash,expires_at,created_surface) VALUES
                    ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',
                    decode('00ff80','hex'),'2026-01-02 03:04:05.123456+08','back');
                    UPDATE cms_media_settings SET max_library_bytes=9007199254740993;
                    """);
        }
        Connection c = source.getConnection();
        var before = RecoveryInventory.inspect(c, media);
        assertTrue(c.isClosed());
        assertEquals(20, before.tables().size());
        var principal = row(before, "cms_principal");
        assertNull(principal.get("email"));
        assertEquals("2026-01-01 19:04:05.123456+00", principal.get("created_at"));
        assertEquals("\\x00ff80", row(before, "cms_session").get("token_hash"));
        assertEquals("{back,\"comma,value\"}", row(before, "cms_permission").get("allowed_surfaces"));
        assertEquals("{\"number\": 9007199254740993}", row(before, "cms_permission").get("predicate_json"));
        assertEquals("9007199254740993", row(before, "cms_media_settings").get("max_library_bytes"));
        assertThrows(UnsupportedOperationException.class, () -> principal.put("email", "changed"));
        assertEquals(before, RecoveryInventory.inspect(source.getConnection(), media));
    }

    @Test void PP1c_extraColumnRejected() throws Exception {
        var source = PostgresFixture.cleanDataSource();
        try (var c = source.getConnection(); var s = c.createStatement()) {
            s.execute("ALTER TABLE cms_media ADD COLUMN surprise text");
        }
        var failure = assertThrows(RecoveryInventory.Failure.class,
                () -> RecoveryInventory.inspect(source.getConnection(), media));
        assertEquals("SCHEMA_UNSUPPORTED", failure.code());
    }

    @Test void PP1c_extraRelationRejected() throws Exception {
        var source = PostgresFixture.cleanDataSource();
        try (var c = source.getConnection(); var s = c.createStatement()) {
            s.execute("CREATE TABLE unexpected(id integer)");
        }
        assertEquals("SCHEMA_UNSUPPORTED", assertThrows(RecoveryInventory.Failure.class,
                () -> RecoveryInventory.inspect(source.getConnection(), media)).code());
    }

    @Test void PP1c_readyTransactionKeepsSnapshotAndRejectsWrites() throws Exception {
        var source = PostgresFixture.cleanDataSource();
        try (var c = source.getConnection()) {
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            c.setAutoCommit(false);
            try (var s = c.createStatement(); var r = s.executeQuery("SELECT max_files FROM cms_media_settings")) {
                assertTrue(r.next());
                assertEquals(10000, r.getInt(1));
            }
            try (var other = source.getConnection(); var s = other.createStatement()) {
                s.executeUpdate("UPDATE cms_media_settings SET max_files=12345");
            }
            assertEquals("10000", row(RecoveryInventory.inspect(c, media), "cms_media_settings").get("max_files"));
        }
        try (var c = source.getConnection()) {
            c.setReadOnly(true);
            c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            c.setAutoCommit(false);
            try (var s = c.createStatement()) {
                assertThrows(java.sql.SQLException.class, () -> s.executeUpdate("DELETE FROM cms_media_settings"));
            }
            c.rollback();
        }
    }

    static Map<String, String> row(RecoveryInventory.Inventory inventory, String table) {
        return inventory.tables().stream().filter(t -> t.tableName().equals(table)).findFirst().orElseThrow().rows().getFirst();
    }
}
