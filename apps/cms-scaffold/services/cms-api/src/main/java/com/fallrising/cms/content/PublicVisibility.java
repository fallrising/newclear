package com.fallrising.cms.content;

import com.fallrising.cms.content.domain.ContentTypeRecord;

import java.util.Map;

/**
 * Public visibility of a published payload, read from the type's visibilityField (02 BD-05).
 * A type without visibilityField, or a payload whose value is missing or blank, is "public".
 */
public final class PublicVisibility {

    private PublicVisibility() {}

    /** True when the entry may appear in public lists: visibility is "public". */
    public static boolean indexable(ContentTypeRecord type, Map<String, Object> payload) {
        return "public".equals(visibility(type, payload));
    }

    /** True when the entry may be read by id or slug: visibility is not "private" ("unlisted" is readable, BQ-02). */
    public static boolean gettable(ContentTypeRecord type, Map<String, Object> payload) {
        return !"private".equals(visibility(type, payload));
    }

    static String visibility(ContentTypeRecord type, Map<String, Object> payload) {
        String field = type == null ? null : type.visibilityField();
        if (field == null || payload == null || payload.get(field) == null) {
            return "public";
        }
        String raw = String.valueOf(payload.get(field));
        return raw.isBlank() ? "public" : raw;
    }
}
