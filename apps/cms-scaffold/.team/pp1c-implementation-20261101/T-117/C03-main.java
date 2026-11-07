package com.fallrising.cms.ops;

import java.io.IOException;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.*;

/** Offline, read-only inventory. Raw records belong only in the private artifact. */
public final class RecoveryInventory {
    private RecoveryInventory() {}

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
        return new Inventory(1, List.of(), List.of(), List.of(), List.of(), "", "");
    }

    static void validateRelations(Set<String> names) throws Failure {}

    static List<FileRow> scanFiles(Path root, Runnable afterRead) throws IOException {
        return List.of();
    }

    static List<FileRow> mediaFiles(Path root, List<AssetRow> assets, List<VariantRow> variants)
            throws IOException {
        return List.of();
    }
}
