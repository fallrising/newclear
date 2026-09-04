package com.cloudform.dto.field;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.enums.ComponentType;
import com.cloudform.domain.enums.FormTarget;
import com.cloudform.domain.enums.ValueSource;

import java.util.UUID;

public record FieldConfigResponse(
        UUID id,
        UUID templateId,
        String fieldKey,
        String tfPath,
        String displayName,
        String description,
        String groupKey,
        FormTarget formTarget,
        ValueSource valueSource,
        ComponentType componentType,
        boolean required,
        boolean editable,
        int displayOrder,
        String fixedValueJson,
        String defaultValueJson,
        String dataSourceJson,
        String validationJson,
        String dependsOnJson,
        String tfType,
        boolean tfRequired,
        boolean tfComputed,
        String tfDefault
) {

    public static FieldConfigResponse from(FieldConfig f) {
        return new FieldConfigResponse(
                f.getId(),
                f.getTemplate() != null ? f.getTemplate().getId() : null,
                f.getFieldKey(),
                f.getTfPath(),
                f.getDisplayName(),
                f.getDescription(),
                f.getGroupKey(),
                f.getFormTarget(),
                f.getValueSource(),
                f.getComponentType(),
                f.isRequired(),
                f.isEditable(),
                f.getDisplayOrder(),
                f.getFixedValueJson(),
                f.getDefaultValueJson(),
                f.getDataSourceJson(),
                f.getValidationJson(),
                f.getDependsOnJson(),
                f.getTfType(),
                f.isTfRequired(),
                f.isTfComputed(),
                f.getTfDefault()
        );
    }
}
