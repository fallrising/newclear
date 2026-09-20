package com.fallrising.cms.content;

import java.util.Map;

public final class PublicVisibility {

    private PublicVisibility() {}

    public static boolean indexable(Map<String, Object> payload) {
        return "public".equals(visibility(payload));
    }

    public static boolean gettable(Map<String, Object> payload) {
        return !"private".equals(visibility(payload));
    }

    static String visibility(Map<String, Object> payload) {
        if (payload == null || payload.get("visibility") == null) {
            return "public";
        }
        String raw = String.valueOf(payload.get("visibility"));
        return raw.isBlank() ? "public" : raw;
    }
}
