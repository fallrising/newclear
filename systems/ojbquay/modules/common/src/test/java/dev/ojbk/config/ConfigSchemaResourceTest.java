package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ConfigSchemaResourceTest {
    private final ObjectMapper objectMapper = new ObjectMapper();

    @ParameterizedTest
    @ValueSource(strings = {"topic", "group", "subscription"})
    void publishesParseableVersionedConfigSchemas(String entity) throws Exception {
        String resource = "config-schema/" + entity + ".schema.json";
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertThat(input).as(resource).isNotNull();
            assertThat(objectMapper.readTree(input).path("$schema").asText())
                    .isEqualTo("https://json-schema.org/draft/2020-12/schema");
        }
    }
}
