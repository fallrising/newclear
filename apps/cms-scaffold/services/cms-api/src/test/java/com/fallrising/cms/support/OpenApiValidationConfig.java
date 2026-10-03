package com.fallrising.cms.support;

import org.springframework.boot.test.autoconfigure.web.servlet.MockMvcBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Applies OpenAPI response validation to every MockMvc built by @AutoConfigureMockMvc. */
@Configuration(proxyBeanMethods = false)
public class OpenApiValidationConfig {

    @Bean
    MockMvcBuilderCustomizer openApiResponseValidation() {
        return builder -> builder.alwaysExpect(OpenApiResponseValidator.conformsToOpenApi());
    }
}
