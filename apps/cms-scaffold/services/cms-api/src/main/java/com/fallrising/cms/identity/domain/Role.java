package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

public record Role(UUID id, String code, String displayName, boolean system, Instant createdAt) {}
