package com.cloudform.dto.schema;

import com.cloudform.terraform.TfFieldNode;

import java.util.List;

public record SchemaTreeResponse(
        String provider,
        String version,
        String resourceName,
        String description,
        List<TfFieldNode> fields
) {
}
