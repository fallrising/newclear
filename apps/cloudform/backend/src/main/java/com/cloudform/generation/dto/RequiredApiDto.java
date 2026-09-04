package com.cloudform.generation.dto;

import java.util.List;

public record RequiredApiDto(
        String path,
        String method,
        List<String> params,
        String description,
        String source
) {}
