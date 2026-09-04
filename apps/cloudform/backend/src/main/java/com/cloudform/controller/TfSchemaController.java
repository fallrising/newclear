package com.cloudform.controller;

import com.cloudform.dto.ApiResponse;
import com.cloudform.dto.schema.ResourceSchemaSummary;
import com.cloudform.dto.schema.SchemaSourceItem;
import com.cloudform.dto.schema.SchemaTreeResponse;
import com.cloudform.service.TfSchemaService;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/tf-schemas")
@Tag(name = "TF Schemas", description = "Pre-generated Terraform provider schemas")
public class TfSchemaController {

    private final TfSchemaService service;

    public TfSchemaController(TfSchemaService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<SchemaSourceItem>> listSources() {
        return ApiResponse.ok(service.listSources());
    }

    @GetMapping("/{provider}/{version}/resources")
    public ApiResponse<List<ResourceSchemaSummary>> listResources(
            @PathVariable String provider,
            @PathVariable String version) {
        return ApiResponse.ok(service.listResources(provider, version));
    }

    @GetMapping("/{provider}/{version}/resources/{resourceName}")
    public ApiResponse<SchemaTreeResponse> getResourceTree(
            @PathVariable String provider,
            @PathVariable String version,
            @PathVariable String resourceName) {
        return ApiResponse.ok(service.getResourceTree(provider, version, resourceName));
    }
}
