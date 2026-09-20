package com.fallrising.cms.identity.domain;

import java.util.Locale;

public enum PrincipalStatus {
    ACTIVE,
    DISABLED,
    LOCKED;

    public String wire() {
        return name().toLowerCase(Locale.ROOT);
    }

    public static PrincipalStatus fromWire(String raw) {
        return valueOf(raw.trim().toUpperCase(Locale.ROOT));
    }
}
