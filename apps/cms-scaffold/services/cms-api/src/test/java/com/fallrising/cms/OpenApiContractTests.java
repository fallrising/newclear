package com.fallrising.cms;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class OpenApiContractTests {

    @Autowired
    List<RequestMappingHandlerMapping> mappings;

    @Test
    void openApiDocumentsImplementedApiRoutes() throws Exception {
        Set<String> implemented = implementedOperations();
        Set<String> documented = documentedOperations();
        assertThat(implemented)
                .as("implemented but missing from OpenAPI: %s", difference(implemented, documented))
                .isEqualTo(documented);
    }

    @SuppressWarnings("unchecked")
    private Set<String> documentedOperations() throws Exception {
        Yaml yaml = new Yaml();
        Map<String, Object> doc;
        try (InputStream in = new ClassPathResource("openapi/openapi.yaml").getInputStream()) {
            doc = yaml.load(in);
        }
        Map<String, Object> paths = (Map<String, Object>) doc.get("paths");
        assertThat(paths).isNotEmpty();
        Set<String> operations = new TreeSet<>();
        for (Map.Entry<String, Object> path : paths.entrySet()) {
            if (path.getKey().startsWith("/actuator")) {
                continue;
            }
            Map<String, Object> item = (Map<String, Object>) path.getValue();
            for (String method : item.keySet()) {
                if (!isHttpMethod(method)) {
                    continue;
                }
                operations.add(method.toUpperCase(Locale.ROOT) + " " + normalize(path.getKey()));
            }
        }
        return operations;
    }

    private Set<String> implementedOperations() {
        Set<String> operations = new TreeSet<>();
        for (RequestMappingHandlerMapping mapping : mappings) {
        mapping.getHandlerMethods().forEach((info, method) -> {
            for (String pattern : patterns(info)) {
                if (!include(pattern)) {
                    continue;
                }
                Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
                if (methods == null || methods.isEmpty()) {
                    operations.add("GET " + normalize(pattern));
                    continue;
                }
                for (RequestMethod http : methods) {
                    if (http == RequestMethod.HEAD || http == RequestMethod.OPTIONS || http == RequestMethod.TRACE) {
                        continue;
                    }
                    operations.add(http.name() + " " + normalize(pattern));
                }
            }
        });
        }
        return operations;
    }

    private static Set<String> patterns(RequestMappingInfo info) {
        if (info.getPathPatternsCondition() != null) {
            return info.getPathPatternsCondition().getPatternValues();
        }
        if (info.getPatternsCondition() != null) {
            return info.getPatternsCondition().getPatterns();
        }
        return Set.of();
    }

    private static boolean include(String pattern) {
        if (pattern == null) {
            return false;
        }
        return pattern.equals("/openapi.yaml") || pattern.startsWith("/api/v1/");
    }

    private static String normalize(String path) {
        return path.replaceAll("\\{[^}]+}", "{}");
    }

    private static boolean isHttpMethod(String key) {
        return Set.of("get", "post", "put", "patch", "delete").contains(key.toLowerCase(Locale.ROOT));
    }

    private static Set<String> difference(Set<String> left, Set<String> right) {
        Set<String> extra = new LinkedHashSet<>(left);
        extra.removeAll(right);
        Set<String> missing = new LinkedHashSet<>(right);
        missing.removeAll(left);
        extra.addAll(missing.stream().map(item -> "documented-only:" + item).toList());
        return extra;
    }
}
