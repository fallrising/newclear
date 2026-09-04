package com.cloudform.generation;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.generation.dto.RequiredApiDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

@Component
public class RequiredApisExtractor {
    private static final Logger log = LoggerFactory.getLogger(RequiredApisExtractor.class);
    private static final String DEFAULT_SOURCE = "sync_cache";

    private final ObjectMapper objectMapper;

    public RequiredApisExtractor(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public List<RequiredApiDto> extract(List<FieldConfig> fields) {
        // Key by (method + path), value tracks params + which fieldKeys hit it.
        Map<String, Bucket> byEndpoint = new LinkedHashMap<>();

        for (FieldConfig f : fields) {
            String raw = f.getDataSourceJson();
            if (raw == null || raw.isBlank()) continue;
            JsonNode node;
            try {
                node = objectMapper.readTree(raw);
            } catch (Exception e) {
                log.warn("Field '{}' has invalid dataSourceJson: {}", f.getFieldKey(), e.getMessage());
                continue;
            }
            JsonNode typeNode = node.get("type");
            if (typeNode == null || !"API".equalsIgnoreCase(typeNode.asText())) continue;

            String path = textOr(node, "endpoint", null);
            if (path == null) {
                log.warn("Field '{}' is type=API but endpoint missing", f.getFieldKey());
                continue;
            }
            String method = textOr(node, "method", "GET").toUpperCase();
            List<String> params = paramKeys(node.get("params"));
            String key = method + " " + path;

            Bucket b = byEndpoint.computeIfAbsent(key, k -> new Bucket(path, method));
            b.params.addAll(params);
            b.fieldKeys.add(f.getFieldKey());
        }

        List<RequiredApiDto> out = new ArrayList<>();
        for (Bucket b : byEndpoint.values()) {
            String desc = "Data source for " + String.join(", ", b.fieldKeys);
            out.add(new RequiredApiDto(b.path, b.method, new ArrayList<>(b.params), desc, DEFAULT_SOURCE));
        }
        out.sort(Comparator.comparing(RequiredApiDto::path).thenComparing(RequiredApiDto::method));
        return out;
    }

    private static String textOr(JsonNode node, String field, String fallback) {
        JsonNode v = node.get(field);
        return (v == null || v.isNull()) ? fallback : v.asText(fallback);
    }

    private static List<String> paramKeys(JsonNode params) {
        if (params == null || !params.isObject()) return List.of();
        List<String> keys = new ArrayList<>();
        params.fieldNames().forEachRemaining(keys::add);
        return keys;
    }

    private static final class Bucket {
        final String path;
        final String method;
        final LinkedHashSet<String> params = new LinkedHashSet<>();
        final LinkedHashSet<String> fieldKeys = new LinkedHashSet<>();

        Bucket(String path, String method) {
            this.path = path;
            this.method = method;
        }
    }
}
