package com.cloudform.generation.dto;

import java.time.LocalDateTime;

public record MetadataDto(
        String resourceType,
        String cloudProvider,
        String tfResource,
        String tfProviderVersion,
        String displayName,
        String description,
        String icon,
        LocalDateTime updatedAt
) {}
