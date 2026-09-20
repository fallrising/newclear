package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record RevisionRecord(
        UUID id,
        UUID entryId,
        int revisionNo,
        String slug,
        Map<String, Object> payload,
        Instant publishedAt,
        UUID publishedBy,
        String contentTypeKey) {}
