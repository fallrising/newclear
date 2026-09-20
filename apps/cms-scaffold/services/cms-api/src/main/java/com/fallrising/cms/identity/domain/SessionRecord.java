package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

public record SessionRecord(
        UUID id,
        UUID principalId,
        byte[] tokenHash,
        Instant createdAt,
        Instant expiresAt,
        Instant lastSeenAt,
        Instant revokedAt,
        String createdSurface,
        String ip,
        String userAgent) {

    public boolean revoked() {
        return revokedAt != null;
    }

    public boolean expired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    public SessionRecord seen(Instant now, Instant expiresAt) {
        return new SessionRecord(
                id, principalId, tokenHash, createdAt, expiresAt, now, revokedAt, createdSurface, ip, userAgent);
    }

    public SessionRecord revoke(Instant at) {
        return new SessionRecord(
                id, principalId, tokenHash, createdAt, expiresAt, lastSeenAt, at, createdSurface, ip, userAgent);
    }
}
