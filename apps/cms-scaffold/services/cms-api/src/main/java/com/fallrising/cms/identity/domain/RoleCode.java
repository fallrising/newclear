package com.fallrising.cms.identity.domain;

import java.util.Arrays;
import java.util.Locale;
import java.util.Set;

public enum RoleCode {
    ANONYMOUS("anonymous"),
    MEMBER("member"),
    EDITOR("editor"),
    OPERATOR("operator"),
    ADMIN("admin");

    public static final Set<String> SYSTEM_CODES = Set.of(
            ANONYMOUS.wire, MEMBER.wire, EDITOR.wire, OPERATOR.wire, ADMIN.wire);

    private final String wire;

    RoleCode(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    public static RoleCode fromWire(String raw) {
        String key = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(c -> c.wire.equals(key))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("unknown role: " + raw));
    }
}
