package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * Audit search (02 §4.6). Null means "no condition". from is inclusive, to is exclusive. action matches exactly, or
 * as a prefix when actionPrefix is true. Results are ordered by at descending, then id text ascending.
 */
public record AuditQuery(
        Instant from,
        Instant to,
        UUID actorId,
        String action,
        boolean actionPrefix,
        String category,
        String targetType,
        UUID targetId,
        String outcome,
        int page,
        int size) {

    public long offset() {
        return (page - 1L) * size;
    }
}
