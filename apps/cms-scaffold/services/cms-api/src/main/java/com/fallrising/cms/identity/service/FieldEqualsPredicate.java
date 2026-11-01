package com.fallrising.cms.identity.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * The only predicate form: {"type":"fieldEquals","field":"...","value":"..."}. value may be the placeholder
 * $currentPrincipalId, which stands for the id of the calling principal.
 */
public record FieldEqualsPredicate(String field, String value) {

    public static final String CURRENT_PRINCIPAL = "$currentPrincipalId";

    /** Parsed predicate, or null when the JSON is malformed, of another type, or has a blank field or value. */
    public static FieldEqualsPredicate parse(ObjectMapper mapper, String json) {
        if (json == null || json.isBlank()) return null;
        try {
            JsonNode node = mapper.readTree(json);
            if (!"fieldEquals".equals(node.path("type").asText())) return null;
            String field = node.path("field").asText();
            String value = node.path("value").asText();
            if (field.isBlank() || value.isBlank()) return null;
            return new FieldEqualsPredicate(field, value);
        } catch (Exception e) {
            return null;
        }
    }
}
