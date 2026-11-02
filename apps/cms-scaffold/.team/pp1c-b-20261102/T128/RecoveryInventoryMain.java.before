package com.fallrising.cms.ops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.io.PrintStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;

/** Offline entry point: no Spring context, automatic migrations or environment credentials. */
public final class RecoveryInventoryMain {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Path REQUEST = Path.of("/run/pp1/request.json");
    private RecoveryInventoryMain() {}

    @FunctionalInterface
    interface Connector { Connection connect(String url, Properties properties) throws Exception; }
    @FunctionalInterface
    interface Inspector { Object inspect(Connection connection, Path media) throws Exception; }

    public static int run(String[] args, Map<String, String> env, PrintStream out) {
        return run(args, env, out, System.in, Function.identity(), DriverManager::getConnection,
                RecoveryInventory::inspect);
    }

    static int run(String[] args, Map<String, String> env, PrintStream out, InputStream in,
                   Function<Path, Path> paths, Connector connector, Inspector inspector) {
        Connection connection = null;
        byte[] password = null;
        String failure = null;
        try {
            require(Arrays.equals(args, new String[]{"--request", REQUEST.toString()}));
            byte[] raw = privateBytes(paths.apply(REQUEST), 65536);
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
            finally { properties.remove("password"); Arrays.fill(password, (byte) 0); secret = null; }
            RecoveryInventory.prepare(connection);
            Map<String, Object> backend = backend(connection, text(request, "operationId"));
            String requestHash = RecoveryInventory.sha256(raw);
            writeLine(out, Map.of("version", 1, "operationId", text(request, "operationId"),
                    "side", text(request, "side"), "mode", "INVENTORY", "requestSha256", requestHash,
                    "backend", backend, "readOnly", true));
            byte[] permitBytes;
            try { permitBytes = bounded(() -> in.readNBytes(4097), 30); }
            catch (TimeoutException timeout) { in.close(); throw new Invalid(); }
            require(permitBytes.length <= 4096);
            JsonNode permit = strict(permitBytes);
            keys(permit, "version,operationId,requestSha256,backendSha256,action");
            require(permit.path("version").isInt() && permit.path("version").intValue() == 1);
            require(text(permit, "operationId").equals(text(request, "operationId")));
            require(text(permit, "requestSha256").equals(requestHash));
            require(text(permit, "backendSha256").equals(RecoveryInventory.sha256(RecoveryInventory.canonicalBytes(backend))));
            require(text(permit, "action").equals("READ_INVENTORY"));
            Connection pinned = connection;
            Object inventory = bounded(() -> inspector.inspect(pinned, paths.apply(Path.of("/media"))), 600);
            byte[] inventoryBytes = RecoveryInventory.canonicalBytes(inventory);
            writePrivate(paths.apply(Path.of("/run/pp1/output/inventory.json")), inventoryBytes);
            JsonNode value = JSON.valueToTree(inventory);
            long referenced = 0, orphan = 0;
            java.math.BigInteger fileBytes = java.math.BigInteger.ZERO;
            for (JsonNode file : value.path("files")) {
                if (file.path("classification").asText().equals("referenced")) referenced++; else orphan++;
                fileBytes = fileBytes.add(new java.math.BigInteger(file.path("byteSize").asText()));
            }
            var result = new TreeMap<String, Object>();
            result.put("version", 1); result.put("operationId", text(request, "operationId"));
            result.put("mode", "INVENTORY"); result.put("inventorySha256", RecoveryInventory.sha256(inventoryBytes));
            result.put("dbSnapshotSha256", value.path("dbSnapshotSha256").asText());
            result.put("assetCount", Integer.toString(value.path("assets").size()));
            result.put("referencedFileCount", Long.toString(referenced)); result.put("orphanFileCount", Long.toString(orphan));
            result.put("fileCount", Long.toString(referenced + orphan)); result.put("fileBytes", fileBytes.toString());
            // Success is emitted only after rollback/close and durable private artifact publication.
            if (!connection.isClosed()) { connection.rollback(); connection.close(); }
            connection = null;
            writeLine(out, result);
            return 0;
        } catch (Invalid invalid) {
            failure = "INPUT_INVALID";
        } catch (RecoveryInventory.Failure inventoryFailure) {
            failure = inventoryFailure.code();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt(); failure = "INTERRUPTED";
        } catch (Exception ignored) {
            failure = "CAPTURE_FAILED";
        } finally {
            if (password != null) Arrays.fill(password, (byte) 0);
            if (connection != null) {
                try { if (!connection.isClosed()) connection.rollback(); } catch (Exception ignored) {}
                try { if (!connection.isClosed()) connection.close(); } catch (Exception ignored) {}
            }
        }
        int exit = switch (failure) {
            case "INPUT_INVALID" -> 2;
            case "SCHEMA_UNSUPPORTED", "UNSAFE_MEDIA_PATH", "MISSING_MEDIA_OBJECT", "MEDIA_HASH_MISMATCH",
                    "MEDIA_SIZE_MISMATCH", "IMAGE_VARIANTS_INCOMPLETE" -> 3;
            case "WRITER_NOT_QUIESCED" -> 4;
            case "INTERRUPTED" -> 10;
            default -> 5;
        };
        System.err.println(exit == 5 ? "CAPTURE_FAILED" : failure);
        return exit;
    }

    private static void validateRequest(JsonNode request) throws Exception {
        keys(request, "version,mode,operationId,side,targetId,releaseId,jdbcUrl,dbUser,passwordFile,mediaRoot,outputFile,backupId,rawProofSha256");
        require(request.path("version").isInt() && request.path("version").intValue() == 1);
        require(text(request, "mode").equals("INVENTORY"));
        require(Set.of("source", "target").contains(text(request, "side")));
        String operation = text(request, "operationId");
        require(operation.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"));
        require(text(request, "targetId").matches("pp1-local:[0-9a-f]{32}"));
        require(text(request, "releaseId").matches("sha256:[0-9a-f]{64}"));
        require(text(request, "dbUser").equals("cms_local"));
        require(text(request, "passwordFile").equals("/run/secrets/spring.datasource.password"));
        require(text(request, "mediaRoot").equals("/media"));
        require(text(request, "outputFile").equals("/run/pp1/output/inventory.json"));
        require(request.get("backupId").isNull() && request.get("rawProofSha256").isNull());
        String jdbc = text(request, "jdbcUrl");
        require(jdbc.startsWith("jdbc:postgresql://") && !jdbc.contains("?") && !jdbc.contains("#") && !jdbc.contains("%"));
        java.net.URI uri;
        try { uri = java.net.URI.create(jdbc.substring(5)); } catch (RuntimeException invalid) { throw new Invalid(); }
        require(uri.getHost() != null && uri.getUserInfo() == null && "/cms".equals(uri.getPath()));
        require(uri.getPort() == -1 || uri.getPort() > 0 && uri.getPort() <= 65535);
    }

    private static Map<String, Object> backend(Connection connection, String operation) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.setQueryTimeout(15);
            try (ResultSet row = statement.executeQuery("SELECT pid, extract(epoch FROM backend_start)::text AS \"backendStartEpoch\", "
                    + "datname AS db, usename AS role, client_addr::text AS \"clientAddr\", application_name AS \"applicationName\" "
                    + "FROM pg_stat_activity WHERE pid=pg_backend_pid()")) {
                require(row.next());
                Map<String, Object> result = new TreeMap<>(); int pid = row.getInt("pid"); require(pid > 0); result.put("pid", pid);
                for (String key : List.of("backendStartEpoch", "db", "role", "clientAddr", "applicationName")) {
                    String value = row.getString(key); require(value != null && !value.isBlank()); result.put(key, value);
                }
                require(!row.next() && result.get("db").equals("cms") && result.get("role").equals("cms_local")
                        && result.get("applicationName").equals(operation));
                require(((String) result.get("backendStartEpoch")).matches("[1-9][0-9]*\\.[0-9]+"));
                return Collections.unmodifiableMap(result);
            }
        }
    }

    private static JsonNode strict(byte[] raw) throws Exception {
        try {
            JsonNode node = JSON.readTree(utf8(raw));
            require(node != null && Arrays.equals(raw, RecoveryInventory.canonicalBytes(node)));
            return node;
        } catch (Exception invalid) { throw new Invalid(); }
    }

    private static String utf8(byte[] raw) throws Invalid {
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(raw)).toString();
        } catch (Exception invalid) { throw new Invalid(); }
    }

    private static void keys(JsonNode node, String names) throws Invalid {
        Set<String> actual = new HashSet<>(); node.fieldNames().forEachRemaining(actual::add);
        require(node.isObject() && actual.equals(Set.of(names.split(","))));
    }

    private static String text(JsonNode node, String key) throws Invalid {
        require(node.has(key) && node.get(key).isTextual()); return node.get(key).textValue();
    }

    private static void require(boolean condition) throws Invalid { if (!condition) throw new Invalid(); }
    private static final class Invalid extends Exception {}

    private static void noLinks(Path path) throws Exception {
        Path current = path.toAbsolutePath().getRoot();
        for (Path part : path.toAbsolutePath()) {
            current = current.resolve(part);
            require(!Files.isSymbolicLink(current));
        }
    }

    private static byte[] privateBytes(Path path, int limit) throws Exception {
        try {
            noLinks(path);
            require(Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS));
            require(Files.getPosixFilePermissions(path, LinkOption.NOFOLLOW_LINKS)
                    .equals(PosixFilePermissions.fromString("rw-------")));
            require(((Number) Files.getAttribute(path, "unix:nlink", LinkOption.NOFOLLOW_LINKS)).longValue() == 1);
            require(Files.size(path) <= limit);
            try (var input = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
                byte[] raw = input.readNBytes(limit + 1); require(raw.length <= limit); return raw;
            }
        } catch (Exception invalid) { throw new Invalid(); }
    }

    private static void writePrivate(Path path, byte[] bytes) throws Exception {
        noLinks(path.getParent());
        require(Files.isDirectory(path.getParent(), LinkOption.NOFOLLOW_LINKS));
        require(Files.getPosixFilePermissions(path.getParent(), LinkOption.NOFOLLOW_LINKS)
                .equals(PosixFilePermissions.fromString("rwx------")));
        try (var file = FileChannel.open(path, Set.of(StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS),
                PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString("rw-------")))) {
            ByteBuffer buffer = ByteBuffer.wrap(bytes); while (buffer.hasRemaining()) file.write(buffer);
            file.force(true);
        }
        try (var parent = FileChannel.open(path.getParent(), StandardOpenOption.READ)) { parent.force(true); }
    }

    private static void writeLine(PrintStream out, Object value) throws Exception {
        byte[] bytes = RecoveryInventory.canonicalBytes(value);
        if (bytes.length > 16384) throw new Invalid();
        out.write(bytes); out.flush(); if (out.checkError()) throw new java.io.IOException();
    }

    private static <T> T bounded(Callable<T> action, int seconds) throws Exception {
        ExecutorService executor = Executors.newSingleThreadExecutor(task -> Thread.ofPlatform().daemon().unstarted(task));
        Future<T> future = executor.submit(action);
        try { return future.get(seconds, TimeUnit.SECONDS); }
        catch (ExecutionException wrapped) {
            if (wrapped.getCause() instanceof Exception exception) throw exception;
            throw new java.io.IOException();
        } finally { future.cancel(true); executor.shutdownNow(); }
    }
}
