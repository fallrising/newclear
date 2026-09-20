package com.fallrising.cms.media.domain;

import java.time.Instant;
import java.util.UUID;

public record MediaAttachment(UUID mediaId, UUID entryId, String fieldKey, Instant attachedAt) {}
