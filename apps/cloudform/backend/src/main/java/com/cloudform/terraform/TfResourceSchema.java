package com.cloudform.terraform;

public record TfResourceSchema(
        int version,
        TfBlock block
) {
}
