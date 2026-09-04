package com.cloudform.dto.template;

import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;

import java.time.LocalDateTime;
import java.util.UUID;

public record TemplateResponse(
        UUID id,
        CloudProvider cloudProvider,
        ResourceType resourceType,
        String tfResourceName,
        String tfProviderVersion,
        String displayName,
        String description,
        String icon,
        TemplateStatus status,
        String tfSchemaJson,
        String formConfigJson,
        String tfTemplate,
        String syncConfigJson,
        String createdBy,
        String updatedBy,
        LocalDateTime createdAt,
        LocalDateTime updatedAt,
        Long version
) {

    public static TemplateResponse from(ResourceTemplate t) {
        return new TemplateResponse(
                t.getId(),
                t.getCloudProvider(),
                t.getResourceType(),
                t.getTfResourceName(),
                t.getTfProviderVersion(),
                t.getDisplayName(),
                t.getDescription(),
                t.getIcon(),
                t.getStatus(),
                t.getTfSchemaJson(),
                t.getFormConfigJson(),
                t.getTfTemplate(),
                t.getSyncConfigJson(),
                t.getCreatedBy(),
                t.getUpdatedBy(),
                t.getCreatedAt(),
                t.getUpdatedAt(),
                t.getVersion()
        );
    }
}
