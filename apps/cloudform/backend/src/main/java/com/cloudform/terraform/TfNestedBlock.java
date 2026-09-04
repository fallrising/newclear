package com.cloudform.terraform;

import com.fasterxml.jackson.annotation.JsonProperty;

public record TfNestedBlock(
        @JsonProperty("nesting_mode") String nestingMode,
        TfBlock block,
        @JsonProperty("min_items") Integer minItems,
        @JsonProperty("max_items") Integer maxItems
) {
}
