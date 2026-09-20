package com.fallrising.cms.identity.domain;

import java.time.Instant;
import java.util.UUID;

public record Credential(UUID id, UUID principalId, String type, String secretHash, String algo, Instant rotatedAt) {}
