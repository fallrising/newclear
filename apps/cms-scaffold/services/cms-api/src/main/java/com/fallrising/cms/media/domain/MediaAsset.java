package com.fallrising.cms.media.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record MediaAsset(
        UUID id,
        UUID ownerPrincipalId,
        String title,
        String altText,
        String originalFilename,
        String contentType,
        long byteSize,
        long storedBytes,
        Integer width,
        Integer height,
        String checksumSha256,
        String status,
        Instant deletedAt,
        Instant createdAt,
        Instant updatedAt,
        List<MediaVariant> variants) {

    public boolean available() {
        return "available".equals(status) && deletedAt == null;
    }
}
