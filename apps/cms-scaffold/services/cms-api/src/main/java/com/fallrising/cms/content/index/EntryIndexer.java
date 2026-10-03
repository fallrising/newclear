package com.fallrising.cms.content.index;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/**
 * Computes the cms_entry_index rows of an entry (02 §3.2). Pure: the content stores and the V7 backfill both use it,
 * so every store indexes identically.
 *
 * <p>Indexed fields: enabled fields with indexed=true, plus the type's titleField, sortField, visibilityField,
 * ownerField and every field in publicRequiresPublishedRefs. Value kind by field type:
 * string and markdown → string; enum → enum; int → int (JSON numbers only, preserved as exact decimal);
 * boolean → bool (JSON booleans only); datetime → datetime (ISO-8601 instant or offset date-time);
 * ref and principal-ref → ref (the value's text). Other types and media-ref are not indexed.
 * Null values, blank strings and values of the wrong JSON type produce no row.
 */
public final class EntryIndexer {

    private EntryIndexer() {}

    /** Field keys that get index rows, in key order. Only enabled fields that exist on the type are returned. */
    public static Set<String> indexedKeys(ContentTypeRecord type, List<FieldRecord> fields) {
        Set<String> wanted = new TreeSet<>();
        for (FieldRecord field : fields) {
            if (field.enabled() && field.indexed()) wanted.add(field.fieldKey());
        }
        addIfPresent(wanted, type.titleField());
        addIfPresent(wanted, type.sortField());
        addIfPresent(wanted, type.visibilityField());
        addIfPresent(wanted, type.ownerField());
        type.publicRequiresPublishedRefs().forEach(key -> addIfPresent(wanted, key));
        Set<String> enabled = new TreeSet<>();
        for (FieldRecord field : fields) {
            if (field.enabled() && kind(field.fieldType()) != null) enabled.add(field.fieldKey());
        }
        wanted.retainAll(enabled);
        return wanted;
    }

    /** Index kind of a field type, or null when the type is not indexable. */
    public static String kind(String fieldType) {
        return switch (fieldType) {
            case "string", "markdown" -> "string";
            case "enum" -> "enum";
            case "int" -> "int";
            case "boolean" -> "bool";
            case "datetime" -> "datetime";
            case "ref", "principal-ref" -> "ref";
            default -> null;
        };
    }

    /** Rows for both scopes: WORK from payload, PUBLISHED from publishedPayload (none when it is null). */
    public static List<IndexRow> rows(ContentTypeRecord type, List<FieldRecord> fields, EntryRecord entry) {
        Map<String, FieldRecord> byKey = new LinkedHashMap<>();
        fields.forEach(field -> byKey.put(field.fieldKey(), field));
        List<IndexRow> rows = new ArrayList<>();
        for (String key : indexedKeys(type, fields)) {
            FieldRecord field = byKey.get(key);
            addRow(rows, entry, field, IndexScope.WORK, entry.payload());
            addRow(rows, entry, field, IndexScope.PUBLISHED, entry.publishedPayload());
        }
        return rows;
    }

    private static void addRow(List<IndexRow> rows, EntryRecord entry, FieldRecord field, IndexScope scope,
            Map<String, Object> payload) {
        if (payload == null) return;
        Object value = payload.get(field.fieldKey());
        if (value == null) return;
        String kind = kind(field.fieldType());
        switch (kind) {
            case "string", "enum", "ref" -> {
                if (value instanceof Map<?, ?> || value instanceof List<?>) return;
                String text = String.valueOf(value);
                if (text.isBlank()) return;
                rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, text, null, null, null));
            }
            case "int" -> {
                if (value instanceof Number number) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, decimal(number), null, null));
                }
            }
            case "bool" -> {
                if (value instanceof Boolean bool) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, null, bool, null));
                }
            }
            case "datetime" -> {
                Instant instant = value instanceof String text ? parseInstant(text) : null;
                if (instant != null) {
                    rows.add(new IndexRow(entry.id(), field.fieldKey(), scope, kind, null, null, null, instant));
                }
            }
            default -> {
            }
        }
    }

    private static java.math.BigDecimal decimal(Number number) {
        return new java.math.BigDecimal(number.toString());
    }

    /** ISO-8601 instant ("2026-01-01T09:00:00Z") or offset date-time ("2026-01-01T17:00:00+08:00"); otherwise null. */
    public static Instant parseInstant(String text) {
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException e2) {
                return null;
            }
        }
    }

    private static void addIfPresent(Set<String> keys, String key) {
        if (key != null && !key.isBlank()) keys.add(key);
    }
}
