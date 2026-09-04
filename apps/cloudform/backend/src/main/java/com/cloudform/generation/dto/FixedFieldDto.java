package com.cloudform.generation.dto;

public record FixedFieldDto(
        String key,
        String tfPath,
        String valueSource,
        Object fixedValue,
        String description
) {}
