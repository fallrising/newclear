package com.cloudform.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record TfProviderSchema(
        TfResourceSchema provider,
        @JsonProperty("resource_schemas") Map<String, TfResourceSchema> resourceSchemas,
        @JsonProperty("data_source_schemas") Map<String, TfResourceSchema> dataSourceSchemas
) {
    public TfProviderSchema {
        resourceSchemas = resourceSchemas == null ? Map.of() : resourceSchemas;
        dataSourceSchemas = dataSourceSchemas == null ? Map.of() : dataSourceSchemas;
    }
}
