package com.fallrising.cms.content.domain;

import java.util.Locale;

public enum PublicationState {
    DRAFT,
    PUBLISHED,
    ARCHIVED;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static PublicationState fromWire(String raw) {
        if (raw == null || raw.isBlank()) {
            return DRAFT;
        }
        return valueOf(raw.trim().toUpperCase(Locale.ROOT));
    }
}
