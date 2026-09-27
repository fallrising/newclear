package com.fallrising.cms;

import com.fallrising.cms.api.error.ErrorCode;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.yaml.snakeyaml.Yaml;

import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ErrorCodeContractTests {

    @Test
    @SuppressWarnings("unchecked")
    void B14_errorCodeEnumMatchesOpenApi() throws Exception {
        Map<String, Object> doc;
        try (InputStream in = new ClassPathResource("openapi/openapi.yaml").getInputStream()) {
            doc = new Yaml().load(in);
        }
        Map<String, Object> schemas = (Map<String, Object>) ((Map<String, Object>) doc.get("components")).get("schemas");
        List<String> documented = (List<String>) ((Map<String, Object>) schemas.get("ErrorCode")).get("enum");
        List<String> implemented = Arrays.stream(ErrorCode.values()).map(ErrorCode::wire).toList();
        assertThat(implemented).doesNotHaveDuplicates();
        assertThat(documented).doesNotHaveDuplicates();
        assertThat(implemented).containsExactlyInAnyOrderElementsOf(documented);
    }
}
