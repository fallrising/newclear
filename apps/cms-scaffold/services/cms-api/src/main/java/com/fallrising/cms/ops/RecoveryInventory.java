package com.fallrising.cms.ops;

import java.io.IOException;
import java.math.BigInteger;
import java.awt.image.BufferedImage;
import com.fallrising.cms.media.ImageVariants;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.ByteBuffer;
import java.io.ByteArrayOutputStream;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.ResultSet;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

/** Offline, read-only inventory. Raw records belong only in the private artifact. */
public final class RecoveryInventory {
    private RecoveryInventory() {}

    private static final ObjectMapper JSON = new ObjectMapper().disable(
            com.fasterxml.jackson.core.json.JsonWriteFeature.WRITE_HEX_UPPER_CASE.mappedFeature());
    private static final Comparator<String> CODEPOINT = (a, b) -> Arrays.compareUnsigned(
            a.getBytes(StandardCharsets.UTF_8), b.getBytes(StandardCharsets.UTF_8));
    private static final Map<String, List<String>> COLUMNS = Map.ofEntries(
            Map.entry("cms_principal", List.of("id", "username", "display_name", "email", "status", "failed_login_count", "locked_until", "last_login_at", "created_at", "updated_at", "deleted_at")),
            Map.entry("cms_credential", List.of("id", "principal_id", "type", "secret_hash", "algo", "rotated_at")),
            Map.entry("cms_role", List.of("id", "code", "display_name", "system", "created_at")),
            Map.entry("cms_principal_role", List.of("principal_id", "role_id", "content_type_codes")),
            Map.entry("cms_permission", List.of("id", "role_id", "action", "content_type_code", "predicate_json", "allowed_surfaces", "created_at")),
            Map.entry("cms_session", List.of("id", "principal_id", "token_hash", "created_at", "expires_at", "last_seen_at", "revoked_at", "created_surface", "ip", "user_agent")),
            Map.entry("cms_audit_event", List.of("id", "at", "actor_principal_id", "category", "action", "target_type", "target_id", "surface", "outcome", "ip", "detail_json")),
            Map.entry("cms_content_type", List.of("id", "type_key", "display_name", "plural_display_name", "description", "title_field", "slug_policy", "singleton", "enabled", "previewable", "public_requires_published_refs", "created_at", "updated_at", "sort_field", "visibility_field", "owner_field")),
            Map.entry("cms_field", List.of("id", "content_type_id", "field_key", "field_type", "required", "unique_in_type", "indexed", "visibility", "sort_order", "default_value", "validations", "ref_target_type_key", "on_delete", "enum_values", "help_text", "enabled", "public_bytes", "label", "group_key", "listable", "filterable", "enum_labels", "placeholder")),
            Map.entry("cms_entry", List.of("id", "content_type_id", "slug", "publication_state", "version", "payload", "published_payload", "published_at", "archived_at", "deleted_at", "created_by", "updated_by", "created_at", "updated_at", "publish_requested_at", "publish_requested_by")),
            Map.entry("cms_entry_revision", List.of("id", "entry_id", "revision_no", "slug", "payload", "published_at", "published_by", "content_type_key")),
            Map.entry("cms_entry_ref", List.of("from_entry_id", "field_key", "to_id", "to_kind", "sort_position")),
            Map.entry("cms_entry_index", List.of("entry_id", "field_key", "value_kind", "value_string", "value_int", "value_bool", "value_ts", "scope")),
            Map.entry("cms_navigation_menu", List.of("id", "menu_key", "surface", "publication_state", "version", "document", "published_document", "updated_by", "updated_at")),
            Map.entry("cms_media", List.of("id", "owner_principal_id", "title", "alt_text", "original_filename", "content_type", "byte_size", "stored_bytes", "width", "height", "checksum_sha256", "status", "deleted_at", "created_at", "updated_at")),
            Map.entry("cms_media_variant", List.of("media_id", "variant", "content_type", "byte_size", "width", "height", "object_key")),
            Map.entry("cms_media_attachment", List.of("media_id", "entry_id", "field_key", "attached_at")),
            Map.entry("cms_media_settings", List.of("id", "max_file_bytes", "max_library_bytes", "max_files", "max_files_per_principal", "updated_at")),
            Map.entry("cms_audit_settings", List.of("id", "retention_days", "updated_at", "updated_by")),
            Map.entry("flyway_schema_history", List.of("installed_rank", "version", "description", "type", "script", "checksum", "installed_by", "installed_on", "execution_time", "success")));

    public record AssetRow(UUID id, String contentType, String byteSize, String storedBytes,
            String checksumSha256, Integer width, Integer height, String status) {}
    public record VariantRow(UUID mediaId, String variant, String contentType, String byteSize,
            Integer width, Integer height, String objectKey) {}
    public record FileRow(String objectKey, String byteSize, String sha256, String classification) {}
    public record ColumnInfo(String ordinalPosition, String name, String dataType, String udtSchema,
            String udtName, boolean isNullable, String characterMaximumLength, String numericPrecision,
            String numericScale, String datetimePrecision, String columnDefault, boolean isIdentity,
            String identityGeneration, boolean isGenerated, String generationExpression) {}
    public record ConstraintInfo(String name, String type, String definition,
            boolean deferrable, boolean initiallyDeferred, boolean validated) {}
    public record IndexInfo(String name, String definition, boolean unique, boolean primary,
            boolean valid, boolean ready) {}
    public record TableSchema(List<ColumnInfo> columns, List<ConstraintInfo> constraints,
            List<IndexInfo> indexes) {
        public TableSchema {
            columns = List.copyOf(columns);
            constraints = List.copyOf(constraints);
            indexes = List.copyOf(indexes);
        }
    }
    public record TableSnapshot(String tableName, TableSchema schema, List<Map<String, String>> rows,
            String schemaSha256, String rowsSha256, String rowCount, String snapshotSha256) {
        public TableSnapshot {
            rows = rows.stream().map(row -> Collections.unmodifiableMap(new LinkedHashMap<>(row))).toList();
        }
    }
    public record Inventory(int version, List<FileRow> files, List<TableSnapshot> tables,
            List<AssetRow> assets, List<VariantRow> variants, String dbSnapshotSha256,
            String mediaHeaderSha256) {
        public Inventory {
            files = List.copyOf(files);
            tables = List.copyOf(tables);
            assets = List.copyOf(assets);
            variants = List.copyOf(variants);
        }
    }
    public static final class Failure extends IOException {
        private final String code;
        Failure(String code) { super(code); this.code = code; }
        public String code() { return code; }
    }

    public static Inventory inspect(Connection connection, Path mediaRoot) throws SQLException, IOException {
        try (connection; var transaction = new Rollback(connection)) {
            prepare(connection);
            List<TableSnapshot> tables = readTables(connection);
            String dbHash = sha256(canonicalBytes(tables.stream().map(t -> Map.of(
                    "tableName", t.tableName(), "schemaSha256", t.schemaSha256(),
                    "rowsSha256", t.rowsSha256(), "rowCount", t.rowCount())).toList()));
            List<AssetRow> assets = readAssets(connection);
            List<VariantRow> variants = readVariants(connection);
            List<FileRow> files = mediaFiles(mediaRoot, assets, variants);
            return new Inventory(1, files, tables, assets, variants, dbHash,
                    sha256(canonicalBytes(Map.of("version", 1, "files", files))));
        }
    }

    private record Rollback(Connection connection) implements AutoCloseable {
        public void close() throws SQLException {
            if (!connection.isClosed() && !connection.getAutoCommit()) connection.rollback();
        }
    }

    /** Ready and inspect share this transaction; never reset isolation once it is active. */
    static void prepare(Connection connection) throws SQLException {
        if (connection.getAutoCommit()) {
            connection.setReadOnly(true);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setAutoCommit(false);
        } else if (!connection.isReadOnly()
                || connection.getTransactionIsolation() != Connection.TRANSACTION_REPEATABLE_READ) {
            throw new SQLException("WRITER_NOT_QUIESCED");
        }
        try (var statement = connection.createStatement()) {
            statement.execute("SET LOCAL TIME ZONE 'UTC'");
            statement.execute("SET LOCAL DateStyle = 'ISO, YMD'");
            statement.execute("SET LOCAL IntervalStyle = 'iso_8601'");
            statement.execute("SET LOCAL bytea_output = 'hex'");
            statement.execute("SET LOCAL extra_float_digits = 3");
            statement.execute("SET LOCAL search_path = public, pg_catalog");
        }
    }

    static void validateRelations(Set<String> names) throws Failure {
        if (!names.equals(COLUMNS.keySet())) throw new Failure("SCHEMA_UNSUPPORTED");
    }

    private static List<TableSnapshot> readTables(Connection connection) throws SQLException, IOException {
        Set<String> relations = new HashSet<>();
        try (var statement = connection.createStatement(); var result = statement.executeQuery("""
                SELECT c.relname, c.relkind, n.nspname FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
                  AND c.relkind IN ('r','p','v','m','f','S')
                """)) {
            while (result.next()) {
                if (!result.getString(2).equals("r") || !result.getString(3).equals("public")) {
                    throw new Failure("SCHEMA_UNSUPPORTED");
                }
                relations.add(result.getString(1));
            }
        }
        validateRelations(relations);
        List<TableSnapshot> tables = new ArrayList<>();
        for (String name : COLUMNS.keySet().stream().sorted().toList()) {
            List<String> columns = COLUMNS.get(name);
            Set<String> actual = new HashSet<>();
            try (var statement = connection.prepareStatement("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = ?
                    """)) {
                statement.setString(1, name);
                try (var result = statement.executeQuery()) {
                    while (result.next()) actual.add(result.getString(1));
                }
            }
            if (!actual.equals(new HashSet<>(columns))) throw new Failure("SCHEMA_UNSUPPORTED");
            String selected = String.join(",", columns.stream().map(c -> "\"" + c + "\"::text AS \"" + c + "\"").toList());
            List<Map<String, String>> rows = new ArrayList<>();
            try (var statement = connection.createStatement();
                    var result = statement.executeQuery("SELECT " + selected + " FROM public.\"" + name + "\"")) {
                while (result.next()) {
                    Map<String, String> row = new LinkedHashMap<>();
                    for (String column : columns) row.put(column, result.getString(column));
                    rows.add(row);
                }
            }
            rows.sort((a, b) -> Arrays.compareUnsigned(canonicalBytes(a), canonicalBytes(b)));
            TableSchema schema = readSchema(connection, name);
            tables.add(new TableSnapshot(name, schema, rows, sha256(canonicalBytes(schema)),
                    sha256(canonicalBytes(rows)), Integer.toString(rows.size()),
                    sha256(canonicalBytes(Map.of("schema", schema, "rows", rows)))));
        }
        return List.copyOf(tables);
    }

    private static TableSchema readSchema(Connection connection, String table) throws SQLException, Failure {
        List<ColumnInfo> columns = new ArrayList<>();
        try (var statement = connection.prepareStatement("""
                SELECT ordinal_position::text,column_name,data_type,udt_schema,udt_name,is_nullable,
                  character_maximum_length::text,numeric_precision::text,numeric_scale::text,
                  datetime_precision::text,column_default,is_identity,identity_generation,
                  is_generated,generation_expression
                FROM information_schema.columns WHERE table_schema='public' AND table_name=?
                ORDER BY ordinal_position
                """)) {
            statement.setString(1, table);
            try (var r = statement.executeQuery()) {
                while (r.next()) columns.add(new ColumnInfo(r.getString(1), r.getString(2), r.getString(3),
                        r.getString(4), r.getString(5), "YES".equals(r.getString(6)), r.getString(7),
                        r.getString(8), r.getString(9), r.getString(10), r.getString(11),
                        "YES".equals(r.getString(12)), r.getString(13),
                        !"NEVER".equals(r.getString(14)), r.getString(15)));
            }
        }
        List<ConstraintInfo> constraints = new ArrayList<>();
        try (var statement = connection.prepareStatement("""
                SELECT c.conname,c.contype,pg_catalog.pg_get_constraintdef(c.oid,false),
                  c.condeferrable,c.condeferred,c.convalidated
                FROM pg_catalog.pg_constraint c
                JOIN pg_catalog.pg_class t ON t.oid=c.conrelid
                JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
                WHERE n.nspname='public' AND t.relname=?
                """)) {
            statement.setString(1, table);
            try (var r = statement.executeQuery()) {
                while (r.next()) {
                    String type = switch (r.getString(2)) {
                        case "p" -> "PRIMARY_KEY";
                        case "u" -> "UNIQUE";
                        case "f" -> "FOREIGN_KEY";
                        case "c" -> "CHECK";
                        default -> throw new Failure("SCHEMA_UNSUPPORTED");
                    };
                    constraints.add(new ConstraintInfo(r.getString(1), type, r.getString(3),
                            r.getBoolean(4), r.getBoolean(5), r.getBoolean(6)));
                }
            }
        }
        constraints.sort(Comparator.comparing(ConstraintInfo::name, CODEPOINT));
        List<IndexInfo> indexes = new ArrayList<>();
        try (var statement = connection.prepareStatement("""
                SELECT i.relname,pg_catalog.pg_get_indexdef(x.indexrelid,0,false),
                  x.indisunique,x.indisprimary,x.indisvalid,x.indisready
                FROM pg_catalog.pg_index x
                JOIN pg_catalog.pg_class t ON t.oid=x.indrelid
                JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
                JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
                WHERE n.nspname='public' AND t.relname=?
                """)) {
            statement.setString(1, table);
            try (var r = statement.executeQuery()) {
                while (r.next()) indexes.add(new IndexInfo(r.getString(1), r.getString(2),
                        r.getBoolean(3), r.getBoolean(4), r.getBoolean(5), r.getBoolean(6)));
            }
        }
        indexes.sort(Comparator.comparing(IndexInfo::name, CODEPOINT));
        return new TableSchema(columns, constraints, indexes);
    }

    static byte[] canonicalBytes(Object value) {
        try {
            return (JSON.writeValueAsString(sorted(JSON.valueToTree(value))) + "\n")
                    .getBytes(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new IllegalArgumentException("INPUT_INVALID");
        }
    }

    private static JsonNode sorted(JsonNode node) {
        if (node.isTextual()) validUnicode(node.textValue());
        if (node.isFloatingPointNumber() && !Double.isFinite(node.doubleValue())) {
            throw new IllegalArgumentException("INPUT_INVALID");
        }
        if (node.isObject()) {
            var result = JSON.createObjectNode();
            List<String> keys = new ArrayList<>();
            node.fieldNames().forEachRemaining(keys::add);
            keys.sort(CODEPOINT);
            for (String key : keys) {
                validUnicode(key);
                result.set(key, sorted(node.get(key)));
            }
            return result;
        }
        if (node.isArray()) {
            var result = JSON.createArrayNode();
            node.forEach(child -> result.add(sorted(child)));
            return result;
        }
        return node;
    }

    private static void validUnicode(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (++i == value.length() || !Character.isLowSurrogate(value.charAt(i))) {
                    throw new IllegalArgumentException("INPUT_INVALID");
                }
            } else if (Character.isLowSurrogate(c)) {
                throw new IllegalArgumentException("INPUT_INVALID");
            }
        }
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    static List<FileRow> scanFiles(Path root, Runnable afterRead) throws IOException {
        root = root.toAbsolutePath();
        Map<Path, Map<String, Object>> stamps = rootStamps(root);
        List<FileRow> files = new ArrayList<>();
        Set<String> keys = new HashSet<>();
        try (var opened = Files.newDirectoryStream(root)) {
            if (!(opened instanceof SecureDirectoryStream<Path> directory)) throw new Failure("UNSAFE_MEDIA_PATH");
            checkDirectoryIdentity(directory, stamps.get(root.toAbsolutePath()));
            walkFiles(root, root, directory, files, stamps, keys, afterRead);
            Set<String> afterKeys = new HashSet<>();
            try (var after = directory.newDirectoryStream(Path.of("."), LinkOption.NOFOLLOW_LINKS)) {
                checkDirectoryIdentity(after, stamps.get(root));
                collectKeys(root, root, after, afterKeys);
            }
            if (!keys.equals(afterKeys)) throw new Failure("WRITER_NOT_QUIESCED");
            verifyStamps(root, stamps);
        }
        files.sort(Comparator.comparing(FileRow::objectKey, CODEPOINT));
        return List.copyOf(files);
    }

    private static void verifyStamps(Path root, Map<Path, Map<String, Object>> stamps) throws IOException {
        for (var entry : stamps.entrySet()) {
            if (entry.getKey().startsWith(root)) {
                unchanged(entry.getKey(), entry.getValue());
            } else {
                var current = stamp(entry.getKey());
                if (!kind(current, 0040000) || !Objects.equals(current.get("fileKey"), entry.getValue().get("fileKey"))) {
                    throw new Failure("WRITER_NOT_QUIESCED");
                }
            }
        }
    }

    private static Map<Path, Map<String, Object>> rootStamps(Path root) throws IOException {
        Path absolute = root.toAbsolutePath();
        if (!absolute.equals(absolute.normalize())) throw new Failure("UNSAFE_MEDIA_PATH");
        Map<Path, Map<String, Object>> stamps = new LinkedHashMap<>();
        for (Path path = absolute; path != null; path = path.getParent()) {
            Map<String, Object> stamp = stamp(path);
            if (!kind(stamp, 0040000)) throw new Failure("UNSAFE_MEDIA_PATH");
            stamps.put(path, stamp);
        }
        return stamps;
    }

    private static Map<String, Object> stamp(Path path) throws IOException {
        try {
            return Files.readAttributes(path, "unix:dev,ino,nlink,size,lastModifiedTime,ctime,mode,fileKey",
                    LinkOption.NOFOLLOW_LINKS);
        } catch (UnsupportedOperationException | IllegalArgumentException e) {
            throw new Failure("UNSAFE_MEDIA_PATH");
        }
    }

    private static boolean kind(Map<String, Object> stamp, int expected) {
        return (((Number) stamp.get("mode")).intValue() & 0170000) == expected;
    }

    private static void unchanged(Path path, Map<String, Object> before) throws IOException {
        try {
            if (!before.equals(stamp(path))) throw new Failure("WRITER_NOT_QUIESCED");
        } catch (NoSuchFileException e) {
            throw new Failure("WRITER_NOT_QUIESCED");
        }
    }

    private static void checkDirectoryIdentity(SecureDirectoryStream<Path> directory,
            Map<String, Object> expected) throws IOException {
        if (!Objects.equals(expected.get("fileKey"), directory
                .getFileAttributeView(BasicFileAttributeView.class).readAttributes().fileKey())) {
            throw new Failure("WRITER_NOT_QUIESCED");
        }
    }

    private static void walkFiles(Path root, Path parent, SecureDirectoryStream<Path> directory,
            List<FileRow> files, Map<Path, Map<String, Object>> stamps, Set<String> keys,
            Runnable afterRead) throws IOException {
        List<Path> entries = new ArrayList<>();
        directory.forEach(entries::add);
        for (Path entry : entries) {
            Path name = entry.getFileName();
            Path path = parent.resolve(name);
            Path relative = root.relativize(path);
            if (!Path.of(relative.toString()).equals(relative)) throw new Failure("UNSAFE_MEDIA_PATH");
            String key = relative.toString();
            validKey(key);
            if (!keys.add(key)) throw new Failure("UNSAFE_MEDIA_PATH");
            Map<String, Object> before = stamp(path);
            stamps.put(path, before);
            if (kind(before, 0040000)) {
                try (var child = directory.newDirectoryStream(name, LinkOption.NOFOLLOW_LINKS)) {
                    checkDirectoryIdentity(child, before);
                    walkFiles(root, path, child, files, stamps, keys, afterRead);
                }
            } else {
                CheckedFile file = readFile(directory, name, path, key, before, afterRead, false);
                files.add(file.row());
                if (files.size() > 1_000_000) throw new Failure("UNSAFE_MEDIA_PATH");
            }
            unchanged(path, before);
        }
    }

    private static void collectKeys(Path root, Path parent, SecureDirectoryStream<Path> directory,
            Set<String> keys) throws IOException {
        for (Path entry : directory) {
            Path name = entry.getFileName();
            Path path = parent.resolve(name);
            Path relative = root.relativize(path);
            if (!Path.of(relative.toString()).equals(relative)) throw new Failure("UNSAFE_MEDIA_PATH");
            String key = relative.toString();
            validKey(key);
            if (!keys.add(key)) throw new Failure("UNSAFE_MEDIA_PATH");
            if (directory.getFileAttributeView(name, BasicFileAttributeView.class,
                    LinkOption.NOFOLLOW_LINKS).readAttributes().isDirectory()) {
                try (var child = directory.newDirectoryStream(name, LinkOption.NOFOLLOW_LINKS)) {
                    collectKeys(root, path, child, keys);
                }
            }
        }
    }

    private record CheckedFile(FileRow row, byte[] bytes) {}

    private static CheckedFile readFile(SecureDirectoryStream<Path> directory, Path name, Path path,
            String key, Map<String, Object> before, Runnable afterRead, boolean retain) throws IOException {
        if (!kind(before, 0100000) || ((Number) before.get("nlink")).longValue() != 1) {
            throw new Failure("UNSAFE_MEDIA_PATH");
        }
        var attributes = directory.getFileAttributeView(name, BasicFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS).readAttributes();
        if (!Objects.equals(before.get("fileKey"), attributes.fileKey())) throw new Failure("WRITER_NOT_QUIESCED");
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable"); }
        ByteArrayOutputStream bytes = retain ? new ByteArrayOutputStream() : null;
        long count = 0;
        try (var channel = directory.newByteChannel(name, Set.of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))) {
            ByteBuffer buffer = ByteBuffer.allocate(32768);
            int read;
            while ((read = channel.read(buffer)) != -1) {
                if (bytes != null) bytes.write(buffer.array(), 0, read);
                digest.update(buffer.array(), 0, read);
                count += read;
                buffer.clear();
            }
            afterRead.run();
            if (channel.size() != count) throw new Failure("WRITER_NOT_QUIESCED");
        }
        unchanged(path, before);
        if (((Number) before.get("size")).longValue() != count) throw new Failure("WRITER_NOT_QUIESCED");
        return new CheckedFile(new FileRow(key, Long.toString(count),
                HexFormat.of().formatHex(digest.digest()), "orphan"), bytes == null ? null : bytes.toByteArray());
    }

    private static void validKey(String key) throws Failure {
        if (key.isEmpty() || key.getBytes(StandardCharsets.UTF_8).length > 4096 || key.startsWith("/")
                || key.contains("\\") || key.indexOf(0) >= 0 || key.matches("^[A-Za-z]:.*")) {
            throw new Failure("UNSAFE_MEDIA_PATH");
        }
        for (String component : key.split("/", -1)) {
            if (component.isEmpty() || component.equals(".") || component.equals("..")) throw new Failure("UNSAFE_MEDIA_PATH");
        }
    }

    private static CheckedFile readObject(Path root, String key) throws IOException {
        root = root.toAbsolutePath();
        validKey(key);
        var stamps = rootStamps(root);
        try (var opened = Files.newDirectoryStream(root)) {
            if (!(opened instanceof SecureDirectoryStream<Path> directory)) throw new Failure("UNSAFE_MEDIA_PATH");
            checkDirectoryIdentity(directory, stamps.get(root.toAbsolutePath()));
            CheckedFile result = readObjectAt(directory, root, key, key.split("/"), 0);
            verifyStamps(root, stamps);
            return result;
        }
    }

    private static CheckedFile readObjectAt(SecureDirectoryStream<Path> directory, Path parent, String key,
            String[] components, int offset) throws IOException {
        Path name = Path.of(components[offset]);
        Path path = parent.resolve(name);
        Map<String, Object> before = stamp(path);
        if (offset == components.length - 1) return readFile(directory, name, path, key, before, () -> {}, true);
        if (!kind(before, 0040000)) throw new Failure("UNSAFE_MEDIA_PATH");
        try (var child = directory.newDirectoryStream(name, LinkOption.NOFOLLOW_LINKS)) {
            checkDirectoryIdentity(child, before);
            CheckedFile result = readObjectAt(child, path, key, components, offset + 1);
            unchanged(path, before);
            return result;
        }
    }

    private static List<AssetRow> readAssets(Connection connection) throws SQLException {
        List<AssetRow> assets = new ArrayList<>();
        try (var statement = connection.createStatement(); var r = statement.executeQuery("""
                SELECT id,content_type,byte_size,stored_bytes,checksum_sha256,width,height,status
                FROM public.cms_media ORDER BY id
                """)) {
            while (r.next()) assets.add(new AssetRow(UUID.fromString(r.getString(1)), r.getString(2),
                    r.getString(3), r.getString(4), r.getString(5), integer(r, 6), integer(r, 7), r.getString(8)));
        }
        return List.copyOf(assets);
    }

    private static List<VariantRow> readVariants(Connection connection) throws SQLException {
        List<VariantRow> variants = new ArrayList<>();
        try (var statement = connection.createStatement(); var r = statement.executeQuery("""
                SELECT media_id,variant,content_type,byte_size,width,height,object_key
                FROM public.cms_media_variant ORDER BY media_id,variant
                """)) {
            while (r.next()) variants.add(new VariantRow(UUID.fromString(r.getString(1)), r.getString(2),
                    r.getString(3), r.getString(4), integer(r, 5), integer(r, 6), r.getString(7)));
        }
        return List.copyOf(variants);
    }

    private static Integer integer(ResultSet r, int column) throws SQLException {
        String value = r.getString(column);
        return value == null ? null : Integer.valueOf(value);
    }

    static List<FileRow> mediaFiles(Path root, List<AssetRow> assets, List<VariantRow> variants)
            throws IOException {
        Set<String> types = Set.of("image/jpeg", "image/png", "image/gif", "application/pdf");
        Map<UUID, Map<String, VariantRow>> byAsset = new HashMap<>();
        for (AssetRow asset : assets) {
            if (!types.contains(asset.contentType()) || !Set.of("available", "deleted").contains(asset.status())
                    || asset.checksumSha256() == null || !asset.checksumSha256().matches("[0-9a-f]{64}")
                    || byAsset.put(asset.id(), new HashMap<>()) != null) throw new Failure("SCHEMA_UNSUPPORTED");
            decimal(asset.byteSize());
            decimal(asset.storedBytes());
        }
        Set<String> referenced = new HashSet<>();
        for (VariantRow variant : variants) {
            validKey(variant.objectKey());
            var members = byAsset.get(variant.mediaId());
            if (members == null || !types.contains(variant.contentType())
                    || !Set.of("original", "thumbnail", "web").contains(variant.variant())
                    || members.put(variant.variant(), variant) != null || !referenced.add(variant.objectKey())) {
                throw new Failure("SCHEMA_UNSUPPORTED");
            }
            decimal(variant.byteSize());
        }
        List<FileRow> before = scanFiles(root, () -> {});
        Map<String, FileRow> files = new HashMap<>();
        before.forEach(file -> files.put(file.objectKey(), file));
        for (VariantRow variant : variants) {
            FileRow file = files.get(variant.objectKey());
            if (file == null) throw new Failure("MISSING_MEDIA_OBJECT");
            if (!variant.byteSize().equals(file.byteSize())) throw new Failure("MEDIA_SIZE_MISMATCH");
        }
        for (AssetRow asset : assets) {
            Map<String, VariantRow> members = byAsset.get(asset.id());
            VariantRow original = members.get("original");
            if (original == null) throw new Failure("MISSING_MEDIA_OBJECT");
            FileRow file = files.get(original.objectKey());
            BigInteger total = BigInteger.ZERO;
            for (VariantRow variant : members.values()) total = total.add(decimal(variant.byteSize()));
            if (!original.byteSize().equals(asset.byteSize()) || !total.equals(decimal(asset.storedBytes()))) {
                throw new Failure("MEDIA_SIZE_MISMATCH");
            }
            if (!asset.checksumSha256().equals(file.sha256())) throw new Failure("MEDIA_HASH_MISMATCH");
            if (!asset.contentType().equals(original.contentType())) throw new Failure("SCHEMA_UNSUPPORTED");
            BufferedImage image = null;
            if (asset.contentType().startsWith("image/")) image = ImageVariants.read(checkedBytes(root, file));
            if (image == null) {
                if (members.size() != 1 || asset.width() != null || asset.height() != null
                        || original.width() != null || original.height() != null) throw new Failure("IMAGE_VARIANTS_INCOMPLETE");
            } else {
                if (!members.keySet().equals(Set.of("original", "thumbnail", "web"))
                        || !dimensions(asset.width(), asset.height(), image.getWidth(), image.getHeight())
                        || !dimensions(original.width(), original.height(), image.getWidth(), image.getHeight())) {
                    throw new Failure("IMAGE_VARIANTS_INCOMPLETE");
                }
                validateFitted(root, files, members.get("thumbnail"), image, 320);
                validateFitted(root, files, members.get("web"), image, 1600);
            }
        }
        if (!before.equals(scanFiles(root, () -> {}))) throw new Failure("WRITER_NOT_QUIESCED");
        return before.stream().map(f -> new FileRow(f.objectKey(), f.byteSize(), f.sha256(),
                referenced.contains(f.objectKey()) ? "referenced" : "orphan")).toList();
    }

    private static BigInteger decimal(String value) throws Failure {
        if (value == null || !value.matches("0|[1-9][0-9]*")) throw new Failure("SCHEMA_UNSUPPORTED");
        return new BigInteger(value);
    }

    private static byte[] checkedBytes(Path root, FileRow expected) throws IOException {
        CheckedFile actual = readObject(root, expected.objectKey());
        if (!expected.equals(actual.row())) throw new Failure("WRITER_NOT_QUIESCED");
        return actual.bytes();
    }

    private static boolean dimensions(Integer width, Integer height, int expectedWidth, int expectedHeight) {
        return Objects.equals(width, expectedWidth) && Objects.equals(height, expectedHeight)
                && expectedWidth > 0 && expectedHeight > 0;
    }

    private static void validateFitted(Path root, Map<String, FileRow> files, VariantRow variant,
            BufferedImage original, int maxEdge) throws IOException {
        byte[] bytes = checkedBytes(root, files.get(variant.objectKey()));
        BufferedImage decoded = ImageVariants.read(bytes);
        double scale = Math.min(1.0, maxEdge / (double) Math.max(original.getWidth(), original.getHeight()));
        int width = Math.max(1, (int) Math.round(original.getWidth() * scale));
        int height = Math.max(1, (int) Math.round(original.getHeight() * scale));
        if (!variant.contentType().equals("image/jpeg") || bytes.length < 3
                || (bytes[0] & 255) != 255 || (bytes[1] & 255) != 216 || (bytes[2] & 255) != 255
                || decoded == null || !dimensions(variant.width(), variant.height(), width, height)
                || decoded.getWidth() != width || decoded.getHeight() != height) {
            throw new Failure("IMAGE_VARIANTS_INCOMPLETE");
        }
    }
}
