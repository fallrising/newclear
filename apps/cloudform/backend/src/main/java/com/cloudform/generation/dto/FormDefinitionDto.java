package com.cloudform.generation.dto;

import java.util.List;

public record FormDefinitionDto(
        String title,
        String description,
        List<FormSectionDto> sections
) {}
