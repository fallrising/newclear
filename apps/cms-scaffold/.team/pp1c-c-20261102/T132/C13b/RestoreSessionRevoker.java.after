package com.fallrising.cms.ops;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import com.fasterxml.jackson.databind.JsonNode;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Arrays;
import java.util.Properties;
import java.util.function.Function;
import java.util.concurrent.TimeoutException;
import static com.fallrising.cms.ops.RecoveryInventoryMain.*;
import java.util.Map;
import java.util.UUID;

/** Fixed offline restored-session transaction; never opens another connection. */
public final class RestoreSessionRevoker {
    private RestoreSessionRevoker() {}

    public static int run(String[] args, Map<String, String> env, PrintStream out) {
        return run(args, env, out, System.in, Function.identity(), DriverManager::getConnection);
    }

    static int run(String[] args, Map<String, String> env, PrintStream out, InputStream in,
                   Function<Path, Path> paths, RecoveryInventoryMain.Connector connector) {
        Connection connection = null;
        byte[] password = null;
        boolean writeOwned = false;
        String failure = "SESSION_REVOKE_FAILED";
        int exit = 8;
        try {
            require(Arrays.equals(args, new String[]{"--request", "/run/pp1/request.json"}));
            byte[] raw = privateBytes(paths.apply(Path.of("/run/pp1/request.json")), 65536);
            JsonNode request = strict(raw);
            validateRequest(request);
            password = privateBytes(paths.apply(Path.of(text(request, "passwordFile"))), 65536);
            String secret = utf8(password);
            require(!secret.isEmpty() && !secret.contains("\0") && !secret.contains("\n") && !secret.contains("\r"));
            Properties properties = new Properties();
            properties.setProperty("user", "cms_local"); properties.setProperty("password", secret);
            properties.setProperty("ApplicationName", text(request, "operationId"));
            properties.setProperty("connectTimeout", "15"); properties.setProperty("socketTimeout", "600");
            try { connection = connector.connect(text(request, "jdbcUrl"), properties); }
            finally { properties.remove("password"); Arrays.fill(password, (byte)0); secret = null; }
            RecoveryInventory.prepare(connection);
            Map<String, Object> identity = backend(connection, text(request, "operationId"));
            String requestHash = RecoveryInventory.sha256(raw);
            writeLine(out, Map.of("version", 1, "operationId", text(request, "operationId"), "side", "target",
                    "mode", "REVOKE_SESSIONS", "requestSha256", requestHash, "backend", identity, "readOnly", true));
            byte[] permitBytes;
            try { permitBytes = bounded(() -> in.readNBytes(4097), 30); }
            catch (TimeoutException timeout) { in.close(); throw new Invalid(); }
            require(permitBytes.length <= 4096);
            JsonNode permit = strict(permitBytes);
            keys(permit, "version,operationId,requestSha256,backendSha256,action");
            require(permit.path("version").isInt() && permit.path("version").intValue() == 1);
            require(text(permit, "operationId").equals(text(request, "operationId")));
            require(text(permit, "requestSha256").equals(requestHash));
            require(text(permit, "backendSha256").equals(RecoveryInventory.sha256(RecoveryInventory.canonicalBytes(identity))));
            require(text(permit, "action").equals("REVOKE_SESSIONS"));
            connection.rollback();
            connection.setReadOnly(false);
            connection.setAutoCommit(false);
            Connection pinned = connection;
            Check sameBackend = () -> {
                if (!identity.equals(backend(pinned, text(request, "operationId")))) throw new SQLException();
            };
            sameBackend.verify();
            writeOwned = true;
            Map<String, Object> receipt = revoke(connection, UUID.fromString(text(request, "operationId")),
                    text(request, "backupId"), text(request, "targetId"), sameBackend);
            connection.close();
            connection = null;
            writeLine(out, receipt);
            return 0;
        } catch (Invalid invalid) {
            failure = "INPUT_INVALID"; exit = 2;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); failure = "INTERRUPTED"; exit = 10;
        } catch (Exception ignored) {
            // Commit response or receipt failure is unknown; never repeat SQL or claim rollback.
        } finally {
            if (password != null) Arrays.fill(password, (byte)0);
            if (connection != null) {
                if (!writeOwned) try { if (!connection.isClosed()) connection.rollback(); } catch (Exception ignored) {}
                try { connection.close(); } catch (Exception ignored) {}
            }
        }
        System.err.println(failure);
        return exit;
    }

    private static void validateRequest(JsonNode request) throws Exception {
        keys(request, "version,mode,operationId,side,targetId,releaseId,jdbcUrl,dbUser,passwordFile,mediaRoot,outputFile,backupId,rawProofSha256");
        require(request.path("version").isInt() && request.path("version").intValue() == 1);
        require(text(request, "mode").equals("REVOKE_SESSIONS") && text(request, "side").equals("target"));
        require(text(request, "operationId").matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"));
        require(text(request, "targetId").matches("pp1-local:[0-9a-f]{32}"));
        require(text(request, "releaseId").matches("sha256:[0-9a-f]{64}"));
        require(text(request, "backupId").matches("pp1-\\d{8}T\\d{9}Z-[0-9a-f]{32}"));
        require(text(request, "rawProofSha256").matches("[0-9a-f]{64}"));
        require(text(request, "dbUser").equals("cms_local"));
        require(text(request, "passwordFile").equals("/run/secrets/spring.datasource.password"));
        require(request.get("mediaRoot").isNull() && request.get("outputFile").isNull());
        String jdbc = text(request, "jdbcUrl");
        require(jdbc.startsWith("jdbc:postgresql://") && !jdbc.contains("?") && !jdbc.contains("#") && !jdbc.contains("%"));
        java.net.URI uri;
        try { uri = java.net.URI.create(jdbc.substring(5)); } catch (RuntimeException invalid) { throw new Invalid(); }
        require(uri.getHost() != null && uri.getUserInfo() == null && "/cms".equals(uri.getPath()));
        require(uri.getPort() == -1 || uri.getPort() > 0 && uri.getPort() <= 65535);
    }

    public static Map<String, Object> revoke(Connection connection, UUID operationId,
                                              String backupId, String targetRef) throws Exception {
        return revoke(connection, operationId, backupId, targetRef, () -> {});
    }

    @FunctionalInterface interface Check { void verify() throws Exception; }

    static Map<String, Object> revoke(Connection connection, UUID operationId,
                                     String backupId, String targetRef, Check preCommit) throws Exception {
        boolean commitAttempted = false;
        try {
            if (operationId == null || backupId == null || !backupId.matches("pp1-\\d{8}T\\d{9}Z-[0-9a-f]{32}")
                    || targetRef == null || !targetRef.matches("pp1-local:[0-9a-f]{32}")) throw new SQLException();
            writable(connection);
            Instant at = Instant.now();
            UUID auditId = UUID.randomUUID();
            long count;
            try (var statement = connection.prepareStatement("UPDATE cms_session SET revoked_at = ? WHERE revoked_at IS NULL")) {
                statement.setQueryTimeout(30);
                statement.setTimestamp(1, Timestamp.from(at));
                count = statement.executeLargeUpdate();
            }
            String detail = new String(RecoveryInventory.canonicalBytes(Map.of("operationId", operationId.toString(),
                    "backupId", backupId, "targetRef", targetRef, "revokedCount", Long.toString(count))), StandardCharsets.UTF_8);
            // JdbcTemplate releases only its suppress-close view of this exact existing connection.
            var source = new SingleConnectionDataSource(connection, true);
            new JdbcIdentityStore(source, null).insertAudit(new AuditEvent(auditId, at, null, "AUTH",
                    "PRODUCTION_SESSIONS_INVALIDATED_AFTER_RESTORE", "restore", null, "admin", "ok", null, detail));
            preCommit.verify();
            writable(connection);
            commitAttempted = true;
            connection.commit();
            return Map.of("operationId", operationId.toString(), "backupId", backupId,
                    "revokedCount", Long.toString(count), "auditEventId", auditId.toString(), "committed", true);
        } catch (Exception failure) {
            if (!commitAttempted) {
                try { connection.rollback(); } catch (Exception rollback) { failure.addSuppressed(rollback); }
            }
            throw failure;
        }
    }

    private static void writable(Connection connection) throws SQLException {
        if (connection.isClosed() || connection.getAutoCommit() || connection.isReadOnly()) throw new SQLException();
    }
}
