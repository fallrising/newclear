package com.cloudform.generation.dto;

import java.util.List;

public record FormSectionDto(
        String key,
        String title,
        String description,
        int order,
        List<FieldDefinitionDto> fields
) {}
