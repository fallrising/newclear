package dev.ojbk.config;

import java.util.regex.Pattern;

public record GroupConfig(String name, String token, String owner, boolean enabled) {
    private static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9._-]{0,127}");
    private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{32}");

    public GroupConfig {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new IllegalArgumentException(
                    "group name must start with a letter and contain at most 128 safe characters");
        }
        if (token == null || !TOKEN.matcher(token).matches()) {
            throw new IllegalArgumentException("group token must be exactly 32 lowercase hex characters");
        }
        if (owner == null || owner.isBlank()) {
            throw new IllegalArgumentException("group owner must not be blank");
        }
    }
}
