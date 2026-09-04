package com.cloudform.dto.template;

import jakarta.validation.constraints.Size;

public record UpdateTemplateRequest(
        @Size(max = 200) String displayName,
        String description,
        @Size(max = 50) String icon
) {
}
