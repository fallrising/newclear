package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * How long audit events are kept (surface-admin §7.2): one of ALLOWED_DAYS, default 90. updatedBy is null until an
 * admin changes it.
 */
public record AuditRetention(int days, Instant updatedAt, UUID updatedBy) {

    public static final List<Integer> ALLOWED_DAYS = List.of(30, 90, 365);
    public static final int DEFAULT_DAYS = 90;

    public AuditRetention {
        if (!ALLOWED_DAYS.contains(days)) throw new IllegalArgumentException("retention days must be one of " + ALLOWED_DAYS);
    }
}
