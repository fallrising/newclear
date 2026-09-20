package com.fallrising.cms.identity.domain;

import java.util.Locale;

public enum Surface {
    FRONT,
    BACK,
    ADMIN;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static Surface fromWire(String raw) {
        if (raw == null || raw.isBlank()) {
            return FRONT;
        }
        return switch (raw.trim().toLowerCase(Locale.ROOT)) {
            case "front" -> FRONT;
            case "back" -> BACK;
            case "admin" -> ADMIN;
            default -> FRONT;
        };
    }
}
