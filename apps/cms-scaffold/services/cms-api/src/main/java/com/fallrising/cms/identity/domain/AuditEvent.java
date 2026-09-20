package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

public record AuditEvent(
        UUID id,
        Instant at,
        UUID actorPrincipalId,
        String category,
        String action,
        String targetType,
        UUID targetId,
        String surface,
        String outcome,
        String ip,
        String detailJson) {}
