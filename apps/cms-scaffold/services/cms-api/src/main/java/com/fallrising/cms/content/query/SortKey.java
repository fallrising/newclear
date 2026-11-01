package com.fallrising.cms.content.query;

/**
 * Primary sort. SYSTEM sorts by an entry column (updatedAt, createdAt or publishedAt); FIELD sorts by the index value of
 * fieldKey in the query scope using kind's column. Entries without a value sort last in both directions.
 */
public record SortKey(Source source, String key, String kind, boolean descending) {

    public enum Source { SYSTEM, FIELD }

    public static SortKey system(String key, boolean descending) {
        return new SortKey(Source.SYSTEM, key, null, descending);
    }

    public static SortKey field(String key, String kind, boolean descending) {
        return new SortKey(Source.FIELD, key, kind, descending);
    }
}
