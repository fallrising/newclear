package com.cloudform.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record TfRoot(
        @JsonProperty("format_version") String formatVersion,
        @JsonProperty("provider_schemas") Map<String, TfProviderSchema> providerSchemas
) {
    public TfRoot {
        providerSchemas = providerSchemas == null ? Map.of() : providerSchemas;
    }
}
