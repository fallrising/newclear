package com.cloudform.dto.template;

import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;

import java.time.LocalDateTime;
import java.util.UUID;

public record TemplateSummary(
        UUID id,
        CloudProvider cloudProvider,
        ResourceType resourceType,
        String tfResourceName,
        String tfProviderVersion,
        String displayName,
        String description,
        String icon,
        TemplateStatus status,
        LocalDateTime updatedAt
) {

    public static TemplateSummary from(ResourceTemplate t) {
        return new TemplateSummary(
                t.getId(),
                t.getCloudProvider(),
                t.getResourceType(),
                t.getTfResourceName(),
                t.getTfProviderVersion(),
                t.getDisplayName(),
                t.getDescription(),
                t.getIcon(),
                t.getStatus(),
                t.getUpdatedAt()
        );
    }
}
