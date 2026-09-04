package com.cloudform.generation;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.ValueSource;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

@Component
public class TfTemplateGenerator {
    private static final Logger log = LoggerFactory.getLogger(TfTemplateGenerator.class);

    private final ObjectMapper objectMapper;

    public TfTemplateGenerator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String generate(ResourceTemplate template, List<FieldConfig> fields) {
        String resourceName = template.getTfResourceName();
        if (resourceName == null || resourceName.isBlank()) {
            return "# <missing tf_resource_name on template>\n";
        }

        java.util.LinkedHashMap<String, FieldConfig> byPath = new java.util.LinkedHashMap<>();
        for (FieldConfig f : fields) {
            if (f.getFormTarget() == com.cloudform.domain.enums.FormTarget.RESULT_ONLY) continue;
            String path = f.getTfPath();
            if (path == null || path.isBlank()) continue; // custom fields handled by orchestrator
            if (path.contains(".")) {
                log.warn("Skipping nested-block tfPath '{}' in TF template (not yet supported)", path);
                continue;
            }
            FieldConfig existing = byPath.get(path);
            if (existing == null || preferOver(f, existing)) {
                if (existing != null) {
                    log.warn("tfPath '{}' is claimed by multiple configs ('{}' vs '{}'); using '{}'",
                            path, existing.getFieldKey(), f.getFieldKey(), f.getFieldKey());
                }
                byPath.put(path, f);
            } else {
                log.warn("tfPath '{}' is claimed by multiple configs ('{}' vs '{}'); keeping '{}'",
                        path, existing.getFieldKey(), f.getFieldKey(), existing.getFieldKey());
            }
        }
        List<FieldConfig> mapped = new ArrayList<>(byPath.values());
        mapped.sort(Comparator.comparing(FieldConfig::getTfPath));

        StringBuilder sb = new StringBuilder();
        sb.append("resource \"").append(resourceName).append("\" \"main\" {\n");
        for (FieldConfig f : mapped) {
            String value = renderValue(f);
            if (value == null) continue;
            sb.append("  ").append(f.getTfPath()).append(" = ").append(value).append('\n');
        }
        sb.append("}\n");
        return sb.toString();
    }

    /** FIXED wins (concrete literal beats var ref); else first-seen keeps. */
    private static boolean preferOver(FieldConfig candidate, FieldConfig existing) {
        boolean candFixed = candidate.getValueSource() == ValueSource.FIXED;
        boolean exFixed = existing.getValueSource() == ValueSource.FIXED;
        return candFixed && !exFixed;
    }

    private String renderValue(FieldConfig f) {
        if (f.getValueSource() == ValueSource.FIXED) {
            String raw = f.getFixedValueJson();
            if (raw == null || raw.isBlank()) {
                log.warn("FIXED field '{}' has empty fixedValueJson; skipping", f.getFieldKey());
                return null;
            }
            try {
                JsonNode node = objectMapper.readTree(raw);
                return renderHcl(node, f.getFieldKey());
            } catch (Exception e) {
                log.warn("FIXED field '{}' has invalid fixedValueJson: {}", f.getFieldKey(), e.getMessage());
                return null;
            }
        }
        return "var." + f.getFieldKey();
    }

    private String renderHcl(JsonNode node, String fieldKey) {
        if (node == null || node.isNull()) return "null";
        if (node.isTextual()) return "\"" + escape(node.asText()) + "\"";
        if (node.isBoolean()) return node.asBoolean() ? "true" : "false";
        if (node.isNumber()) return node.numberValue().toString();
        if (node.isArray()) {
            ArrayNode arr = (ArrayNode) node;
            List<String> parts = new ArrayList<>();
            for (JsonNode el : arr) parts.add(renderHcl(el, fieldKey));
            return "[" + String.join(", ", parts) + "]";
        }
        log.warn("FIXED field '{}' has object value; HCL object literal not yet supported", fieldKey);
        return null;
    }

    private String escape(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
