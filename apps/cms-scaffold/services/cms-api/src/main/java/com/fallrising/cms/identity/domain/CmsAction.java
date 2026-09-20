package com.fallrising.cms.identity.domain;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

public enum CmsAction {
    READ_PUBLISHED("read_published"),
    READ_DRAFT("read_draft"),
    CREATE("create"),
    UPDATE("update"),
    PUBLISH("publish"),
    UNPUBLISH("unpublish"),
    DELETE("delete"),
    ARCHIVE("archive"),
    MANAGE_MEDIA("manage_media"),
    MANAGE_TYPES("manage_types"),
    MANAGE_PRINCIPALS("manage_principals"),
    MANAGE_SETTINGS("manage_settings"),
    READ_AUDIT("read_audit");

    public static final Set<CmsAction> FRONT_HARD_DENY = Set.of(
            READ_DRAFT,
            PUBLISH,
            UNPUBLISH,
            DELETE,
            ARCHIVE,
            MANAGE_TYPES,
            MANAGE_PRINCIPALS,
            MANAGE_SETTINGS,
            READ_AUDIT);

    public static final Set<CmsAction> BACK_HARD_DENY = Set.of(
            MANAGE_TYPES,
            MANAGE_PRINCIPALS,
            MANAGE_SETTINGS,
            READ_AUDIT);

    public static final Set<CmsAction> GLOBAL = Set.of(
            MANAGE_MEDIA,
            MANAGE_TYPES,
            MANAGE_PRINCIPALS,
            MANAGE_SETTINGS,
            READ_AUDIT);

    public static final Set<CmsAction> GOVERNANCE = Set.of(
            MANAGE_TYPES,
            MANAGE_PRINCIPALS,
            MANAGE_SETTINGS,
            READ_AUDIT);

    private final String wire;

    CmsAction(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static CmsAction fromWire(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("action is required");
        }
        String key = raw.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(a -> a.wire.equals(key))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown action: " + raw));
    }
}
