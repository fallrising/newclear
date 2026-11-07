package com.fallrising.cms.ops;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.*;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class RecoveryInventoryMainTests {
    @TempDir Path root;
    final String operation = "00112233-4455-6677-8899-aabbccddeeff";
    final String canary = "synthetic-secret-DO-NOT-PRINT";
    final String[] args = {"--request", "/run/pp1/request.json"};
    final ByteArrayOutputStream output = new ByteArrayOutputStream();
    final AtomicInteger connects = new AtomicInteger(), inspections = new AtomicInteger();
    Map<String, Object> request, backend;
    Connection connection;
    byte[] requestBytes;
    final ObjectMapper mapper = new ObjectMapper().enable(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS);

    byte[] bytes(Object value) throws Exception { return (mapper.writeValueAsString(value) + "\n").getBytes(java.nio.charset.StandardCharsets.UTF_8); }
    String hash(byte[] value) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
    Path path(Path fixed) { return root.resolve(fixed.toString().substring(1)); }
    void privateFile(String name, byte[] value) throws Exception {
        Path p = path(Path.of(name)); Files.createDirectories(p.getParent());
        Files.setPosixFilePermissions(p.getParent(), PosixFilePermissions.fromString("rwx------"));
        Files.write(p, value); Files.setPosixFilePermissions(p, PosixFilePermissions.fromString("rw-------"));
    }
    void saveRequest() throws Exception { requestBytes = bytes(request); privateFile("/run/pp1/request.json", requestBytes); }
    byte[] permit() throws Exception {
        return bytes(Map.of("version", 1, "operationId", operation, "requestSha256", hash(requestBytes),
                "backendSha256", hash(bytes(backend)), "action", "READ_INVENTORY"));
    }
    @BeforeEach void fixture() throws Exception {
        request = new TreeMap<>(Map.of("version", 1, "mode", "INVENTORY", "operationId", operation,
                "side", "source", "targetId", "pp1-local:" + "a".repeat(32), "releaseId", "sha256:" + "b".repeat(64),
                "jdbcUrl", "jdbc:postgresql://db:5432/cms", "dbUser", "cms_local",
                "passwordFile", "/run/secrets/spring.datasource.password", "mediaRoot", "/media"));
        request.put("outputFile", "/run/pp1/output/inventory.json"); request.put("backupId", null); request.put("rawProofSha256", null);
        saveRequest(); privateFile("/run/secrets/spring.datasource.password", canary.getBytes());
        Path dir = path(Path.of("/run/pp1/output")); Files.createDirectories(dir);
        Files.setPosixFilePermissions(dir, PosixFilePermissions.fromString("rwx------"));
        Files.createDirectories(path(Path.of("/media")));
        backend = Map.of("pid", 42, "backendStartEpoch", "1730000000.123456", "db", "cms", "role", "cms_local",
                "clientAddr", "172.31.0.2", "applicationName", operation);
        connection = mock(Connection.class); when(connection.getAutoCommit()).thenReturn(false);
        when(connection.isReadOnly()).thenReturn(true); when(connection.getTransactionIsolation()).thenReturn(Connection.TRANSACTION_REPEATABLE_READ);
        Statement statement = mock(Statement.class); ResultSet rows = mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement); when(statement.executeQuery(anyString())).thenReturn(rows);
        when(rows.next()).thenReturn(true, false); when(rows.getInt("pid")).thenReturn(42);
        for (var entry : backend.entrySet()) if (entry.getValue() instanceof String s) when(rows.getString(entry.getKey())).thenReturn(s);
    }
    Object inventory(Connection c, Path media) {
        assertThat(c).isSameAs(connection); assertThat(media).isEqualTo(path(Path.of("/media"))); inspections.incrementAndGet();
        return Map.of("version", 1, "files", List.of(Map.of("objectKey", "a.pdf", "byteSize", "3", "sha256", "a".repeat(64), "classification", "orphan")),
                "tables", List.of(), "assets", List.of(), "variants", List.of(), "dbSnapshotSha256", "b".repeat(64), "mediaHeaderSha256", "c".repeat(64));
    }
    int run(byte[] input) {
        return RecoveryInventoryMain.run(args, Map.of(), new PrintStream(output), new ByteArrayInputStream(input), this::path,
                (url, properties) -> { connects.incrementAndGet(); assertThat(url).isEqualTo(request.get("jdbcUrl"));
                    assertThat(properties.getProperty("password")).isEqualTo(canary); return connection; }, this::inventory);
    }
    @Test void pp1cSuccessBindsReadyPermitAndWritesPrivateArtifactBeforeResult() throws Exception {
        assertThat(run(permit())).isZero(); assertThat(connects.get()).isEqualTo(1); assertThat(inspections.get()).isEqualTo(1);
        String[] lines = output.toString(java.nio.charset.StandardCharsets.UTF_8).split("\n"); assertThat(lines).hasSize(2);
        var ready = mapper.readTree(lines[0]); var result = mapper.readTree(lines[1]);
        assertThat(ready.get("readOnly").asBoolean()).isTrue(); assertThat(ready.get("backend").get("pid").asInt()).isEqualTo(42);
        byte[] file = Files.readAllBytes(path(Path.of("/run/pp1/output/inventory.json")));
        assertThat(result.get("inventorySha256").asText()).isEqualTo(hash(file));
        assertThat(result.get("fileBytes").asText()).isEqualTo("3"); assertThat(result.get("orphanFileCount").asText()).isEqualTo("1");
        assertThat(Files.getPosixFilePermissions(path(Path.of("/run/pp1/output/inventory.json")))).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        assertThat(output.toString()).doesNotContain(canary, "a.pdf", "jdbc:"); verify(connection).rollback(); verify(connection).close();
    }
    @Test void pp1cMalformedRequestRejectedBeforeConnection() throws Exception {
        for (String key : List.of("unknown", "jdbcUrl", "passwordFile", "mode")) {
            Object original = request.put(key, key.equals("jdbcUrl") ? "jdbc:postgresql://db/cms?password=" + canary : canary);
            saveRequest(); assertThat(run(new byte[0])).isEqualTo(2);
            if (original == null) request.remove(key); else request.put(key, original);
        }
        assertThat(connects.get()).isZero(); assertThat(output.toString()).doesNotContain(canary);
    }
    @Test void pp1cDuplicateAndNoncanonicalRequestRejected() throws Exception {
        String raw = new String(requestBytes, java.nio.charset.StandardCharsets.UTF_8);
        for (byte[] bad : List.of((" " + raw).getBytes(), raw.replace("{", "{\"version\":1,").getBytes(),
                new byte[]{(byte)0xc3, 0x28})) {
            privateFile("/run/pp1/request.json", bad); assertThat(run(new byte[0])).isEqualTo(2);
        }
        assertThat(connects.get()).isZero();
    }
    @Test void pp1cPermitMismatchAndTrailingBytesNeverInspect() throws Exception {
        byte[] valid = permit(); byte[] wrong = new String(valid).replace(operation, "a0112233-4455-6677-8899-aabbccddeeff").getBytes();
        assertThat(run(wrong)).isEqualTo(2); assertThat(inspections.get()).isZero(); verify(connection).rollback(); verify(connection).close();
    }
    @Test void pp1cPermitMustEndAtEof() throws Exception {
        assertThat(run((new String(permit()) + "\n").getBytes())).isEqualTo(2); assertThat(inspections.get()).isZero();
    }
    @Test void pp1cUnsafeRequestAndSecretFailBeforeDatabase() throws Exception {
        Files.setPosixFilePermissions(path(Path.of("/run/pp1/request.json")), PosixFilePermissions.fromString("rw-r--r--"));
        assertThat(run(new byte[0])).isEqualTo(2); assertThat(connects.get()).isZero();
    }
    @Test void pp1cExistingOutputIsNeverOverwritten() throws Exception {
        privateFile("/run/pp1/output/inventory.json", "prior".getBytes());
        assertThat(run(permit())).isNotZero(); assertThat(Files.readString(path(Path.of("/run/pp1/output/inventory.json")))).isEqualTo("prior");
        assertThat(output.toString()).doesNotContain("inventorySha256");
    }
    @Test void pp1cFixedArgumentsRejectCallerSelectedRequest() {
        assertThat(RecoveryInventoryMain.run(new String[]{"--request", "/tmp/caller.json"}, Map.of(), new PrintStream(output))).isEqualTo(2);
        assertThat(RecoveryInventoryMain.run(new String[]{"--request", "/run/pp1/request.json", "--request", "/run/pp1/request.json"}, Map.of(), new PrintStream(output))).isEqualTo(2);
    }

    @Test void pp1cLinkedSecretRejectedBeforeConnection() throws Exception {
        Path secret = path(Path.of("/run/secrets/spring.datasource.password"));
        Files.createLink(secret.resolveSibling("alias"), secret);
        assertThat(run(new byte[0])).isEqualTo(2); assertThat(connects.get()).isZero();
        assertThat(output.toString()).doesNotContain(canary);
    }

    @Test void pp1cSymlinkRequestRejectedBeforeConnection() throws Exception {
        Path file = path(Path.of("/run/pp1/request.json")); Path other = file.resolveSibling("actual");
        Files.move(file, other); Files.createSymbolicLink(file, other);
        assertThat(run(new byte[0])).isEqualTo(2); assertThat(connects.get()).isZero();
    }

    @Test void pp1cOversizeRequestRejectedBeforeConnection() throws Exception {
        privateFile("/run/pp1/request.json", new byte[65537]);
        assertThat(run(new byte[0])).isEqualTo(2); assertThat(connects.get()).isZero();
    }

    @Test void pp1cEmptyPermitRollsBackAndClosesWithoutInspection() throws Exception {
        assertThat(run(new byte[0])).isEqualTo(2); assertThat(inspections.get()).isZero();
        verify(connection).rollback(); verify(connection).close();
        assertThat(output.toString().split("\n")).hasSize(1);
    }

    @Test void pp1cWrongBackendHashRejectsPermit() throws Exception {
        byte[] value = new String(permit()).replace(hash(bytes(backend)), "0".repeat(64)).getBytes();
        assertThat(run(value)).isEqualTo(2); assertThat(inspections.get()).isZero();
    }

    @Test void pp1cDatabaseFailureNeverLeaksCauseOrPrintsSuccess() throws Exception {
        int code = RecoveryInventoryMain.run(args, Map.of("SPRING_DATASOURCE_PASSWORD", canary), new PrintStream(output),
                new ByteArrayInputStream(new byte[0]), this::path,
                (url, properties) -> { throw new SQLException(canary); }, this::inventory);
        assertThat(code).isEqualTo(5); assertThat(output.size()).isZero(); assertThat(inspections.get()).isZero();
    }

    @Test void pp1cReceiptIsNotEmittedWhenRollbackFails() throws Exception {
        doThrow(new SQLException(canary)).when(connection).rollback();
        assertThat(run(permit())).isEqualTo(5); verify(connection).close();
        assertThat(output.toString()).doesNotContain(canary, "inventorySha256");
    }

    @Test void pp1cCanonicalBytesMatchNodeProtocolVector() {
        Map<String, Object> row = new HashMap<>();
        row.put("bytea", "\\x00ff"); row.put("newline", "a\nb"); row.put("secret_hash", null);
        row.put("value", "9007199254740993");
        Map<String, Object> value = new HashMap<>();
        value.put("\ud800\udc00", "supplementary"); value.put("\ue000", null);
        value.put("2", "two"); value.put("10", "ten"); value.put("row", row);
        assertThat(RecoveryInventory.sha256(RecoveryInventory.canonicalBytes(value)))
                .isEqualTo("aedd61aa4377225296140bd0c166259a7aa94016ec6236cbc45562b7f894e0a8");
    }
}
