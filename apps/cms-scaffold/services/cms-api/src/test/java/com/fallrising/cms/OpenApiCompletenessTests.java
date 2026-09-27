package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiCompletenessTests {

    static final Set<String> METHODS = Set.of("get", "post", "put", "patch", "delete");

    @Test
    void B01_everyOperationHasSuccessSchemaAndErrors() throws Exception {
        List<String> problems = new ArrayList<>();
        for (Op op : operations()) {
            Map<String, Object> responses = op.responses();
            List<String> success = responses.keySet().stream().filter(k -> k.startsWith("2")).toList();
            if (success.isEmpty()) {
                problems.add(op.name() + ": no 2xx response");
            }
            for (String status : success) {
                Map<String, Object> response = response(responses.get(status));
                if (!"204".equals(status) && !hasSchema(response)) {
                    problems.add(op.name() + ": " + status + " has no content schema");
                }
            }
            if (responses.keySet().stream().noneMatch(k -> k.startsWith("4") || k.startsWith("5"))) {
                problems.add(op.name() + ": no error response");
            }
            if (!op.path().equals("/actuator/health") && !responses.containsKey("500")) {
                problems.add(op.name() + ": no 500 response");
            }
            if (!op.isPublic() && !responses.containsKey("401")) {
                problems.add(op.name() + ": authenticated operation without 401");
            }
            for (String status : responses.keySet()) {
                if ((status.startsWith("4") || status.startsWith("5")) && !op.path().equals("/actuator/health")) {
                    Object raw = responses.get(status);
                    if (!(raw instanceof Map<?, ?> map && String.valueOf(map.get("$ref")).equals("#/components/responses/Error" + status))) {
                        problems.add(op.name() + ": " + status + " must reference #/components/responses/Error" + status);
                    }
                }
            }
        }
        assertThat(problems).isEmpty();
    }

    record Op(String path, String method, Map<String, Object> operation) {
        String name() {
            return method.toUpperCase() + " " + path;
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> responses() {
            return (Map<String, Object>) operation.get("responses");
        }

        boolean isPublic() {
            Object security = operation.get("security");
            return security instanceof List<?> list && list.isEmpty();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> response(Object raw) throws Exception {
        Map<String, Object> map = (Map<String, Object>) raw;
        if (map.containsKey("$ref")) {
            String name = String.valueOf(map.get("$ref")).substring("#/components/responses/".length());
            return (Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>) document().get("components")).get("responses")).get(name);
        }
        return map;
    }

    @SuppressWarnings("unchecked")
    private static boolean hasSchema(Map<String, Object> response) {
        Object content = response.get("content");
        if (!(content instanceof Map<?, ?> types) || types.isEmpty()) {
            return false;
        }
        return types.values().stream().allMatch(v -> v instanceof Map<?, ?> m && m.get("schema") != null);
    }

    @SuppressWarnings("unchecked")
    private static List<Op> operations() throws Exception {
        List<Op> ops = new ArrayList<>();
        Map<String, Object> paths = (Map<String, Object>) document().get("paths");
        for (Map.Entry<String, Object> path : paths.entrySet()) {
            for (Map.Entry<String, Object> item : ((Map<String, Object>) path.getValue()).entrySet()) {
                if (METHODS.contains(item.getKey())) {
                    ops.add(new Op(path.getKey(), item.getKey(), (Map<String, Object>) item.getValue()));
                }
            }
        }
        return ops;
    }

    private static Map<String, Object> document() throws Exception {
        try (InputStream in = new ClassPathResource("openapi/openapi.yaml").getInputStream()) {
            return new Yaml().load(in);
        }
    }
}
