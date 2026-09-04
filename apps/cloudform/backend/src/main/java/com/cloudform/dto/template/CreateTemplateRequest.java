package com.cloudform.dto.template;

import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record CreateTemplateRequest(
        @NotNull CloudProvider cloudProvider,
        @NotNull ResourceType resourceType,
        @NotBlank @Size(max = 100) String tfResourceName,
        @Size(max = 50) String tfProviderVersion,
        @NotBlank @Size(max = 200) String displayName,
        String description,
        @Size(max = 50) String icon
) {
}
