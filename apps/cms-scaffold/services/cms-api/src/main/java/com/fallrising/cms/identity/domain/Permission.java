package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record Permission(
        UUID id,
        UUID roleId,
        String action,
        String contentTypeCode,
        String predicateJson,
        List<String> allowedSurfaces,
        Instant createdAt) {}
