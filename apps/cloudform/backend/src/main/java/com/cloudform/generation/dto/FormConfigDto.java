package com.cloudform.generation.dto;

public record FormConfigDto(
        String version,
        MetadataDto metadata,
        FormsDto forms
) {}
