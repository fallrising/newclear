package com.cloudform.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

public record TfAttribute(
        JsonNode type,
        String description,
        @JsonProperty("description_kind") String descriptionKind,
        boolean required,
        boolean optional,
        boolean computed,
        boolean sensitive
) {
}
