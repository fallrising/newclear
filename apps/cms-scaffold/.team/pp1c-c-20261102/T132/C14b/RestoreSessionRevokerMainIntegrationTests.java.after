package com.fallrising.cms.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import java.io.*;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
@Timeout(45)
class RestoreSessionRevokerMainIntegrationTests {
    static final String OP = "00112233-4455-6677-8899-aabbccddeeff";
    static final String SECRET = "synthetic-revoke-secret-canary";
    static final ObjectMapper JSON = new ObjectMapper();
    @Container static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("cms").withUsername("cms_local").withPassword(SECRET);
    @TempDir Path root;
    enum Fault { NONE, PERMIT, REPLACEMENT, COMMIT_RESPONSE, RECEIPT }
    Path path(Path fixed) { return root.resolve(fixed.toString().substring(1)); }
    Connection observer() throws SQLException { return DriverManager.getConnection(PG.getJdbcUrl(), "cms_local", SECRET); }
    void file(String name, byte[] bytes) throws Exception {
        Path p = path(Path.of(name)); Files.createDirectories(p.getParent());
        Files.setPosixFilePermissions(p.getParent(), PosixFilePermissions.fromString("rwx------"));
        Files.write(p, bytes); Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
    }
    @BeforeEach void setup() throws Exception {
        var flyway = Flyway.configure().dataSource(PG.getJdbcUrl(), "cms_local", SECRET)
                .locations("classpath:db/migration").cleanDisabled(false).load();
        flyway.clean(); flyway.migrate();
        try (var c = observer(); var s = c.createStatement()) {
            s.execute("INSERT INTO cms_principal(id,username,display_name,status) VALUES ('" + OP + "','restored','Restored','active')");
            s.execute("INSERT INTO cms_session(id,principal_id,token_hash,expires_at,created_surface) VALUES "
                    + "(gen_random_uuid(),'" + OP + "','\\x01',now()+interval '1 day','admin'),"
                    + "(gen_random_uuid(),'" + OP + "','\\x02',now()+interval '1 day','back')");
        }
    }
    int count(String sql) throws SQLException {
        try (var c = observer(); var s = c.createStatement(); var rows = s.executeQuery(sql)) { rows.next(); return rows.getInt(1); }
    }
    void exercise(Fault fault) throws Exception {
        var request = new TreeMap<String, Object>(Map.of("version", 1, "mode", "REVOKE_SESSIONS", "operationId", OP,
                "side", "target", "targetId", "pp1-local:" + "a".repeat(32), "releaseId", "sha256:" + "b".repeat(64),
                "jdbcUrl", "jdbc:postgresql://" + PG.getHost() + ":" + PG.getMappedPort(5432) + "/cms", "dbUser", "cms_local", "passwordFile", "/run/secrets/spring.datasource.password",
                "backupId", "pp1-20261102T142500000Z-" + "c".repeat(32)));
        request.put("mediaRoot", null); request.put("outputFile", null); request.put("rawProofSha256", "d".repeat(64));
        byte[] raw = RecoveryInventory.canonicalBytes(request);
        file("/run/pp1/request.json", raw); file("/run/secrets/spring.datasource.password", SECRET.getBytes(StandardCharsets.UTF_8));
        var readyBytes = new CompletableFuture<byte[]>();
        var stdout = new ByteArrayOutputStream();
        var lines = new AtomicInteger();
        var commits = new AtomicInteger(); var rollbacks = new AtomicInteger(); var connects = new AtomicInteger();
        var connections = new CopyOnWriteArrayList<Connection>();
        OutputStream receiver = new OutputStream() {
            @Override public void write(int b) { throw new AssertionError("expected complete canonical line"); }
            @Override public void write(byte[] b, int off, int len) throws IOException {
                byte[] value = Arrays.copyOfRange(b, off, off + len);
                int n = lines.incrementAndGet();
                if (n == 2 && fault == Fault.RECEIPT) throw new IOException("synthetic stdout failure");
                stdout.write(value);
                if (n == 1) readyBytes.complete(value);
            }
        };
        var executor = Executors.newSingleThreadExecutor(Thread.ofPlatform().daemon().factory());
        try (var input = new PipedInputStream(); var permit = new PipedOutputStream(input); var out = new PrintStream(receiver, true, StandardCharsets.UTF_8)) {
            var done = executor.submit(() -> { int exit = RestoreSessionRevoker.run(new String[]{"--request", "/run/pp1/request.json"}, Map.of(), out,
                    input, this::path, (url, properties) -> {
                        connects.incrementAndGet();
                        Properties retained = new Properties(); retained.putAll(properties);
                        Connection[] current = {DriverManager.getConnection(url, properties)}; connections.add(current[0]);
                        return (Connection) Proxy.newProxyInstance(getClass().getClassLoader(), new Class[]{Connection.class}, (p, method, args) -> {
                            if (method.getName().equals("rollback")) rollbacks.incrementAndGet();
                            if (method.getName().equals("commit")) commits.incrementAndGet();
                            try {
                                Object value = method.invoke(current[0], args);
                                if (fault == Fault.REPLACEMENT && method.getName().equals("setReadOnly") && Boolean.FALSE.equals(args[0])) {
                                    current[0].close(); current[0] = DriverManager.getConnection(url, retained); connections.add(current[0]);
                                }
                                if (fault == Fault.COMMIT_RESPONSE && method.getName().equals("commit")) throw new SQLException("unknown commit response");
                                return value;
                            } catch (InvocationTargetException e) { throw e.getCause(); }
                        });
                    });
                readyBytes.completeExceptionally(new AssertionError("runner ended before Ready: " + exit));
                return exit;
            });
            JsonNode ready = JSON.readTree(readyBytes.get(15, TimeUnit.SECONDS));
            assertTrue(ready.path("readOnly").booleanValue());
            assertEquals(RecoveryInventory.sha256(raw), ready.path("requestSha256").textValue());
            assertEquals("REVOKE_SESSIONS", ready.path("mode").textValue()); assertEquals("target", ready.path("side").textValue());
            assertTrue(connections.getFirst().isReadOnly()); assertFalse(connections.getFirst().getAutoCommit());
            assertEquals(Connection.TRANSACTION_REPEATABLE_READ, connections.getFirst().getTransactionIsolation());
            assertEquals(0, count("SELECT count(*) FROM cms_session WHERE revoked_at IS NOT NULL"));
            assertEquals(0, count("SELECT count(*) FROM cms_audit_event"));
            var backend = ready.path("backend"); int pid = backend.path("pid").intValue();
            try (var c = observer(); var s = c.prepareStatement("SELECT extract(epoch FROM backend_start)::text, host(client_addr),application_name,datname,usename FROM pg_stat_activity WHERE pid=?")) {
                s.setInt(1, pid);
                try (var row = s.executeQuery()) {
                    assertTrue(row.next()); assertEquals(row.getString(1), backend.path("backendStartEpoch").textValue());
                    assertEquals(row.getString(2), backend.path("clientAddr").textValue());
                    assertEquals(OP, row.getString(3)); assertEquals("cms", row.getString(4)); assertEquals("cms_local", row.getString(5)); assertFalse(row.next());
                }
            }
            var permission = Map.of("version", 1, "operationId", OP, "requestSha256", RecoveryInventory.sha256(raw),
                    "backendSha256", RecoveryInventory.sha256(RecoveryInventory.canonicalBytes(backend)),
                    "action", fault == Fault.PERMIT ? "READ_INVENTORY" : "REVOKE_SESSIONS");
            permit.write(RecoveryInventory.canonicalBytes(permission)); permit.close();
            assertEquals(fault == Fault.NONE ? 0 : fault == Fault.PERMIT ? 2 : 8, done.get(15, TimeUnit.SECONDS));
            assertEquals(1, connects.get());
            assertEquals(fault == Fault.REPLACEMENT ? 2 : 1, connections.size());
            for (var c : connections) assertTrue(c.isClosed());
            boolean changed = fault == Fault.NONE || fault == Fault.COMMIT_RESPONSE || fault == Fault.RECEIPT;
            assertEquals(changed ? 1 : 0, commits.get());
            assertEquals(changed ? 1 : 0, count("SELECT count(*) FROM cms_audit_event"));
            assertEquals(changed ? 2 : 0, count("SELECT count(*) FROM cms_session WHERE revoked_at IS NOT NULL"));
            if (changed) assertEquals(1, rollbacks.get(), "only readonly prep rollback; no rollback after commit attempt");
            assertEquals(0, count("SELECT count(*) FROM pg_stat_activity WHERE pid=" + pid));
            String text = stdout.toString(StandardCharsets.UTF_8);
            assertFalse(text.contains(SECRET)); assertFalse(text.contains("jdbc:")); assertFalse(text.contains("token_hash"));
            String[] messages = text.split("\n"); assertEquals(fault == Fault.NONE ? 2 : 1, messages.length);
            if (fault == Fault.NONE) {
                var receipt = JSON.readTree(messages[1]);
                Set<String> keys = new HashSet<>(); receipt.fieldNames().forEachRemaining(keys::add);
                assertEquals(Set.of("operationId", "backupId", "revokedCount", "auditEventId", "committed"), keys);
                assertEquals(OP, receipt.path("operationId").textValue()); assertEquals("2", receipt.path("revokedCount").textValue());
                assertTrue(receipt.path("committed").booleanValue());
                assertEquals(1, count("SELECT count(*) FROM cms_audit_event WHERE id='" + UUID.fromString(receipt.path("auditEventId").textValue()) + "'"));
            }
        } finally {
            executor.shutdownNow();
            for (var c : connections) if (!c.isClosed()) c.close();
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS));
        }
    }
    @Test void PP1c_actualPgSameBackendReadonlyReadyThenAtomicCommit() throws Exception { exercise(Fault.NONE); }
    @Test void PP1c_actualPgWrongPermitNeverWrites() throws Exception { exercise(Fault.PERMIT); }
    @Test void PP1c_actualPgPhysicalBackendReplacementRejected() throws Exception { exercise(Fault.REPLACEMENT); }
    @Test void PP1c_actualPgCommitResponseLostNoRollbackOrSqlRetry() throws Exception { exercise(Fault.COMMIT_RESPONSE); }
    @Test void PP1c_actualPgReceiptFailureDoesNotRollbackCommittedChange() throws Exception { exercise(Fault.RECEIPT); }
}
