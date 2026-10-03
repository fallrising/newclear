package com.fallrising.cms.content.query;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexScope;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Parses the query parameters of the work and public list endpoints (02 §4.1). Every rejected input throws
 * 400 VALIDATION_FAILED whose message names the parameter. Parameters not listed here are ignored when supplied once.
 *
 * <ul>
 *   <li>page: integer ≥ 1, default 1. size: integer 1..100, default 20.</li>
 *   <li>sort: one key, optional "-" prefix for descending. Keys: updatedAt, createdAt, publishedAt, title
 *       (the type's titleField), or a sortable field. Default: work -updatedAt; public sortField ascending when the
 *       type has one, otherwise -publishedAt.</li>
 *   <li>state (work only): comma-separated subset of draft, published, archived; default draft,published.</li>
 *   <li>q: substring of the titleField value; blank means no filter.</li>
 *   <li>filter.&lt;field&gt;: equality on a filterable field; datetime fields take filter.&lt;field&gt;.from
 *       (inclusive) and filter.&lt;field&gt;.to (exclusive) instead. Each name at most once.</li>
 *   <li>ref.&lt;field&gt;: target entry id; may repeat, all must match. Blank values are ignored.</li>
 * </ul>
 *
 * A field is sortable or filterable when it is enabled and gets index rows (EntryIndexer.indexedKeys); filterable
 * additionally requires filterable=true; sortable excludes ref kinds. In public lists only fields with
 * visibility public qualify, and ref.&lt;field&gt; must name a public ref field.
 */
public final class ListQueryParser {

    public static final int DEFAULT_SIZE = 20;
    public static final int MAX_SIZE = 100;
    public static final List<String> DEFAULT_WORK_STATES = List.of("draft", "published");

    private static final Set<String> STATES = Set.of("draft", "published", "archived");
    private static final Set<String> SYSTEM_SORTS = Set.of("updatedAt", "createdAt", "publishedAt");
    private static final Set<String> REF_TYPES = Set.of("ref", "media-ref", "principal-ref");

    /** Parsed parameters; the service adds type, scope, access and the public rules to build an EntryQuery. */
    public record Parsed(
            List<String> states,
            String q,
            List<FieldFilter> filters,
            List<RefFilter> refs,
            SortKey sort,
            int page,
            int size) {}

    private ListQueryParser() {}

    public static Parsed parse(ContentTypeRecord type, List<FieldRecord> fields, IndexScope scope, Map<String, String[]> params) {
        params.forEach((name, values) -> {
            if (!name.startsWith("ref.") && values != null && values.length > 1) {
                throw ContentException.invalidParameter(name + " must not repeat");
            }
        });
        Map<String, FieldRecord> byKey = new LinkedHashMap<>();
        fields.forEach(f -> byKey.put(f.fieldKey(), f));
        Set<String> indexed = EntryIndexer.indexedKeys(type, fields);
        boolean publicScope = scope == IndexScope.PUBLISHED;

        int page = intParam(params, "page", 1, 1, Integer.MAX_VALUE);
        int size = intParam(params, "size", DEFAULT_SIZE, 1, MAX_SIZE);
        List<String> states = publicScope ? List.of("published") : states(params);
        String q = single(params, "q");
        SortKey sort = sort(type, byKey, indexed, publicScope, single(params, "sort"));

        List<FieldFilter> filters = new ArrayList<>();
        Map<String, Instant[]> ranges = new LinkedHashMap<>();
        List<RefFilter> refs = new ArrayList<>();
        for (Map.Entry<String, String[]> param : params.entrySet()) {
            String name = param.getKey();
            if (name.startsWith("filter.")) {
                String value = single(params, name);
                if (value == null || value.isBlank()) throw ContentException.invalidParameter(name + " must not be blank");
                String rest = name.substring("filter.".length());
                String suffix = rest.endsWith(".from") ? "from" : rest.endsWith(".to") ? "to" : null;
                String key = suffix == null ? rest : rest.substring(0, rest.length() - suffix.length() - 1);
                FieldRecord field = byKey.get(key);
                if (field == null || !field.enabled() || !field.filterable() || !indexed.contains(key)
                        || (publicScope && !"public".equals(field.visibility()))) {
                    throw ContentException.invalidParameter(name + ": field is not filterable");
                }
                String kind = EntryIndexer.kind(field.fieldType());
                if ("datetime".equals(kind) != (suffix != null)) {
                    throw ContentException.invalidParameter("datetime".equals(kind)
                            ? name + ": use filter." + key + ".from or filter." + key + ".to"
                            : name + ": .from and .to apply to datetime fields only");
                }
                if (suffix != null) {
                    Instant instant = EntryIndexer.parseInstant(value);
                    if (instant == null) throw ContentException.invalidParameter(name + " must be an ISO-8601 date-time with offset");
                    ranges.computeIfAbsent(key, k -> new Instant[2])["from".equals(suffix) ? 0 : 1] = instant;
                } else {
                    filters.add(FieldFilter.equalsValue(key, kind, filterValue(name, kind, value)));
                }
            } else if (name.startsWith("ref.")) {
                String key = name.substring("ref.".length());
                if (publicScope) {
                    FieldRecord field = byKey.get(key);
                    if (field == null || !field.enabled() || !REF_TYPES.contains(field.fieldType())
                            || !"public".equals(field.visibility())) {
                        throw ContentException.invalidParameter(name + ": field is not a public ref field");
                    }
                }
                for (String raw : param.getValue()) {
                    if (raw == null || raw.isBlank()) continue;
                    refs.add(new RefFilter(key, uuid(name, raw)));
                }
            }
        }
        ranges.forEach((key, bounds) -> filters.add(FieldFilter.range(key, bounds[0], bounds[1])));
        return new Parsed(states, q, filters, refs, sort, page, size);
    }

    private static List<String> states(Map<String, String[]> params) {
        String raw = single(params, "state");
        if (raw == null || raw.isBlank()) return DEFAULT_WORK_STATES;
        List<String> states = Arrays.stream(raw.split(",")).map(String::trim).filter(s -> !s.isEmpty()).distinct().toList();
        if (states.isEmpty()) return DEFAULT_WORK_STATES;
        for (String state : states) {
            if (!STATES.contains(state)) throw ContentException.invalidParameter("state: unknown value " + state);
        }
        return states;
    }

    private static SortKey sort(ContentTypeRecord type, Map<String, FieldRecord> byKey, Set<String> indexed,
            boolean publicScope, String raw) {
        if (raw == null || raw.isBlank()) {
            if (!publicScope) return SortKey.system("updatedAt", true);
            FieldRecord sortField = type.sortField() == null ? null : byKey.get(type.sortField());
            if (sortable(sortField, indexed, true)) {
                return SortKey.field(sortField.fieldKey(), EntryIndexer.kind(sortField.fieldType()), false);
            }
            return SortKey.system("publishedAt", true);
        }
        boolean descending = raw.startsWith("-");
        String key = descending ? raw.substring(1) : raw;
        if (SYSTEM_SORTS.contains(key)) return SortKey.system(key, descending);
        if ("title".equals(key)) {
            FieldRecord title = byKey.get(type.titleField());
            if (publicScope && !sortable(title, indexed, true)) {
                throw ContentException.invalidParameter("sort: title is not sortable");
            }
            String kind = title == null || EntryIndexer.kind(title.fieldType()) == null ? "string" : EntryIndexer.kind(title.fieldType());
            return SortKey.field(type.titleField(), kind, descending);
        }
        FieldRecord field = byKey.get(key);
        String kind = field == null ? null : EntryIndexer.kind(field.fieldType());
        if (!sortable(field, indexed, publicScope)) {
            throw ContentException.invalidParameter("sort: " + key + " is not sortable");
        }
        return SortKey.field(key, kind, descending);
    }

    private static boolean sortable(FieldRecord field, Set<String> indexed, boolean publicScope) {
        if (field == null || !field.enabled() || !indexed.contains(field.fieldKey())) return false;
        String kind = EntryIndexer.kind(field.fieldType());
        return kind != null && !"ref".equals(kind)
                && (!publicScope || "public".equals(field.visibility()));
    }

    private static Object filterValue(String name, String kind, String value) {
        return switch (kind) {
            case "int" -> {
                try {
                    yield Long.parseLong(value);
                } catch (NumberFormatException e) {
                    throw ContentException.invalidParameter(name + " must be an integer");
                }
            }
            case "bool" -> {
                if (!"true".equals(value) && !"false".equals(value)) {
                    throw ContentException.invalidParameter(name + " must be true or false");
                }
                yield Boolean.parseBoolean(value);
            }
            default -> value;
        };
    }

    private static int intParam(Map<String, String[]> params, String name, int fallback, int min, int max) {
        String raw = single(params, name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            int value = Integer.parseInt(raw.trim());
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) {
            throw ContentException.invalidParameter(max == Integer.MAX_VALUE
                    ? name + " must be a positive integer"
                    : name + " must be an integer from " + min + " to " + max);
        }
    }

    /** The only value of a parameter, or null when absent; a repeated parameter is rejected. */
    private static String single(Map<String, String[]> params, String name) {
        String[] values = params.get(name);
        if (values == null || values.length == 0) return null;
        if (values.length > 1) throw ContentException.invalidParameter(name + " must not repeat");
        return values[0];
    }

    private static UUID uuid(String name, String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw ContentException.invalidParameter(name + " must be a UUID");
        }
    }
}
