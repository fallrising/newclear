package com.cloudform.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.Map;

public record TfBlock(
        Map<String, TfAttribute> attributes,
        @JsonProperty("block_types") Map<String, TfNestedBlock> blockTypes,
        String description,
        @JsonProperty("description_kind") String descriptionKind
) {
    public TfBlock {
        attributes = attributes == null ? Map.of() : attributes;
        blockTypes = blockTypes == null ? Map.of() : blockTypes;
    }
}
