package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record NavigationRecord(
        UUID id,
        String menuKey,
        String surface,
        String publicationState,
        int version,
        Map<String, Object> document,
        Map<String, Object> publishedDocument,
        UUID updatedBy,
        Instant updatedAt) {}
