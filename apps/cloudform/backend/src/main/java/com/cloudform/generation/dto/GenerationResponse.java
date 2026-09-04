package com.cloudform.generation.dto;

import java.util.List;

public record GenerationResponse(
        FormConfigDto formConfig,
        String terraformTemplate,
        List<RequiredApiDto> requiredApis
) {}
