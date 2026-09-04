package com.cloudform.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI cloudFormOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("CloudForm API")
                        .description("Terraform Schema-Driven cloud resource provisioning")
                        .version("0.1.0"));
    }
}
