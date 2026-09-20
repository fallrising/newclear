package com.fallrising.cms.api;

import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OpenApiController {

    @GetMapping(value = "/openapi.yaml", produces = "text/yaml;charset=UTF-8")
    public Resource openApi() {
        return new ClassPathResource("openapi/openapi.yaml");
    }
}
