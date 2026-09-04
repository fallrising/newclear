package com.cloudform.terraform;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.util.NoSuchElementException;

/**
 * Parses `terraform providers schema -json` output.
 *
 * The JSON uses snake_case keys; we use a dedicated ObjectMapper instead of
 * leaking that naming convention into Spring's primary mapper.
 */
@Component
public class TfSchemaParser {

    private final ObjectMapper mapper;

    public TfSchemaParser() {
        this.mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public TfRoot parse(InputStream in) {
        try {
            return mapper.readValue(in, TfRoot.class);
        } catch (IOException e) {
            throw new TfSchemaParseException("Failed to parse TF schema JSON", e);
        }
    }

    public TfRoot parse(String json) {
        try {
            return mapper.readValue(json, TfRoot.class);
        } catch (IOException e) {
            throw new TfSchemaParseException("Failed to parse TF schema JSON", e);
        }
    }

    /**
     * Look up a single resource schema. There is usually one provider entry
     * per file (e.g. `registry.terraform.io/aliyun/alicloud`); the lookup
     * scans all entries.
     */
    public TfResourceSchema findResource(TfRoot root, String resourceName) {
        for (TfProviderSchema provider : root.providerSchemas().values()) {
            TfResourceSchema schema = provider.resourceSchemas().get(resourceName);
            if (schema != null) return schema;
        }
        throw new NoSuchElementException("Resource not found: " + resourceName);
    }

    /**
     * Render a TF type expression as a human-readable string.
     * Examples:
     *   "string"                       -> "string"
     *   ["list", "string"]             -> "list(string)"
     *   ["map", "string"]              -> "map(string)"
     *   ["set", ["map", "string"]]     -> "set(map(string))"
     *   ["object", {"k":"string"}]     -> "object(...)"
     */
    public String renderType(JsonNode typeNode) {
        if (typeNode == null || typeNode.isNull()) return "any";
        if (typeNode.isTextual()) return typeNode.asText();
        if (typeNode.isArray() && typeNode.size() >= 1) {
            String kind = typeNode.get(0).asText();
            if (typeNode.size() == 1) return kind;
            JsonNode inner = typeNode.get(1);
            if (inner.isObject()) return kind + "(...)";
            return kind + "(" + renderType(inner) + ")";
        }
        return typeNode.toString();
    }
}
