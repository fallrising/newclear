package com.fallrising.cms.content.index;

import java.util.Locale;

/** WORK indexes the working copy (payload); PUBLISHED indexes the published copy (publishedPayload). */
public enum IndexScope {
    WORK,
    PUBLISHED;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static IndexScope fromWire(String raw) {
        return valueOf(raw.toUpperCase(Locale.ROOT));
    }
}
