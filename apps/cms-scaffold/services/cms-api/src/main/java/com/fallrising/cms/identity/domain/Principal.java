package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

public record Principal(
        UUID id,
        String username,
        String displayName,
        String email,
        PrincipalStatus status,
        int failedLoginCount,
        Instant lockedUntil,
        Instant lastLoginAt,
        Instant createdAt,
        Instant updatedAt,
        Instant deletedAt) {

    public boolean deleted() {
        return deletedAt != null;
    }

    public Principal withStatus(PrincipalStatus next, Instant now) {
        return new Principal(
                id, username, displayName, email, next, failedLoginCount, lockedUntil, lastLoginAt, createdAt, now, deletedAt);
    }

    public Principal withLock(int failures, Instant lockedUntil, PrincipalStatus status, Instant now) {
        return new Principal(
                id, username, displayName, email, status, failures, lockedUntil, lastLoginAt, createdAt, now, deletedAt);
    }

    public Principal withLoginSuccess(Instant now) {
        return new Principal(
                id, username, displayName, email, PrincipalStatus.ACTIVE, 0, null, now, createdAt, now, deletedAt);
    }

    public Principal withProfile(String displayName, String email, Instant now) {
        return new Principal(
                id,
                username,
                displayName,
                email,
                status,
                failedLoginCount,
                lockedUntil,
                lastLoginAt,
                createdAt,
                now,
                deletedAt);
    }
}
