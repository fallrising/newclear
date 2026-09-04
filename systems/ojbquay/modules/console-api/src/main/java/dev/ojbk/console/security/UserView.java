package dev.ojbk.console.security;

import java.time.Instant;

public record UserView(
        long id,
        String username,
        String role,
        boolean enabled,
        Instant createdAt) {}
