package com.cloudform.dto.schema;

public record ResourceSchemaSummary(String resourceName, int attributeCount, int nestedBlockCount, String description) {
}
