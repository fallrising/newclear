package com.fallrising.cms.ops;

import java.io.IOException;
import java.nio.file.Path;
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

    private static final ObjectMapper JSON = new ObjectMapper();
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
            return new Inventory(1, List.of(), tables, List.of(), List.of(), dbHash,
                    sha256(canonicalBytes(Map.of("version", 1, "files", List.of()))));
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
                SELECT c.relname, c.relkind FROM pg_catalog.pg_class c
                JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f','S')
                """)) {
            while (result.next()) {
                if (!result.getString(2).equals("r")) throw new Failure("SCHEMA_UNSUPPORTED");
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
        if (node.isObject()) {
            var result = JSON.createObjectNode();
            List<String> keys = new ArrayList<>();
            node.fieldNames().forEachRemaining(keys::add);
            keys.sort(CODEPOINT);
            for (String key : keys) result.set(key, sorted(node.get(key)));
            return result;
        }
        if (node.isArray()) {
            var result = JSON.createArrayNode();
            node.forEach(child -> result.add(sorted(child)));
            return result;
        }
        return node;
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    static List<FileRow> scanFiles(Path root, Runnable afterRead) throws IOException {
        return List.of();
    }

    static List<FileRow> mediaFiles(Path root, List<AssetRow> assets, List<VariantRow> variants)
            throws IOException {
        return List.of();
    }
}
