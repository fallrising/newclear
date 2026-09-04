package dev.ojbk.pipeline;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.jayway.jsonpath.JsonPath;
import com.jayway.jsonpath.PathNotFoundException;
import java.util.Arrays;
import java.util.Map;

public final class TransitMapper {
    private final ObjectMapper objectMapper;

    public TransitMapper() {
        this(new ObjectMapper());
    }

    TransitMapper(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void validate(Map<String, String> targetToSource) {
        targetToSource.forEach((target, source) -> {
            targetSegments(target);
            try {
                JsonPath.compile(source);
            } catch (RuntimeException invalid) {
                throw new IllegalArgumentException(
                        "source path is not valid JSONPath", invalid);
            }
        });
    }

    public String map(String json, Map<String, String> targetToSource) {
        try {
            JsonNode parsed = objectMapper.readTree(json);
            if (!(parsed instanceof ObjectNode root)) {
                throw new IllegalArgumentException("transit input must be a JSON object");
            }
            targetToSource.keySet().stream().sorted().forEach(target -> {
                String source = targetToSource.get(target);
                try {
                    Object value = JsonPath.read(json, source);
                    put(root, target, objectMapper.valueToTree(value));
                } catch (PathNotFoundException missing) {
                    // A missing source is explicitly skipped.
                }
            });
            return objectMapper.writeValueAsString(root);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("transit input is not valid JSON", exception);
        }
    }

    private static void put(ObjectNode root, String targetPath, JsonNode value) {
        String[] segments = targetSegments(targetPath);
        ObjectNode current = root;
        for (int index = 0; index < segments.length - 1; index++) {
            String segment = segments[index];
            JsonNode child = current.get(segment);
            if (child == null || child.isNull()) {
                current = current.putObject(segment);
            } else if (child instanceof ObjectNode objectChild) {
                current = objectChild;
            } else {
                throw new IllegalArgumentException(
                        "target path crosses a non-object field: " + segment);
            }
        }
        current.set(segments[segments.length - 1], value);
    }

    private static String[] targetSegments(String targetPath) {
        if (targetPath == null || !targetPath.startsWith("$.") || targetPath.length() < 3) {
            throw new IllegalArgumentException("target path must start with '$.'");
        }
        String[] segments = targetPath.substring(2).split("\\.");
        if (Arrays.stream(segments).anyMatch(segment -> !segment.matches("[A-Za-z0-9_-]+"))) {
            throw new IllegalArgumentException("target path contains an unsupported segment");
        }
        return segments;
    }
}
