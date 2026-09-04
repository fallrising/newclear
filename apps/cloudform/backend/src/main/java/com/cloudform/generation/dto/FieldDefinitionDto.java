package com.cloudform.generation.dto;

import java.util.List;

/**
 * dataSource / validation / dependsOn / defaultValue are emitted as parsed JSON
 * (Object) so the wire format is real nested JSON, not stringified blobs.
 */
public record FieldDefinitionDto(
        String key,
        String tfPath,
        String displayName,
        String description,
        String componentType,
        boolean required,
        boolean editable,
        int order,
        Object dataSource,
        Object validation,
        List<String> dependsOn,
        Object defaultValue
) {}
