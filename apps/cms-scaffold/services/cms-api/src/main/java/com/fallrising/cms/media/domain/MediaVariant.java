package com.fallrising.cms.media.domain;

import java.util.UUID;

public record MediaVariant(
        UUID mediaId,
        String variant,
        String contentType,
        long byteSize,
        Integer width,
        Integer height,
        String objectKey) {}
