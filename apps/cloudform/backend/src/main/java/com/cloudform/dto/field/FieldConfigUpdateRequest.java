package com.cloudform.dto.field;

import com.cloudform.domain.enums.ComponentType;
import com.cloudform.domain.enums.FormTarget;
import com.cloudform.domain.enums.ValueSource;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record FieldConfigUpdateRequest(
        @NotBlank @Size(max = 100) String fieldKey,
        @Size(max = 200) String tfPath,
        @Size(max = 200) String displayName,
        String description,
        @Size(max = 50) String groupKey,
        @NotNull FormTarget formTarget,
        @NotNull ValueSource valueSource,
        @NotNull ComponentType componentType,
        boolean required,
        boolean editable,
        int displayOrder,
        String fixedValueJson,
        String defaultValueJson,
        String dataSourceJson,
        String validationJson,
        String dependsOnJson
) {
}
