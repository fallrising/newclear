package com.cloudform.controller;

import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;
import com.cloudform.dto.ApiResponse;
import com.cloudform.dto.PageResponse;
import com.cloudform.dto.template.CreateTemplateRequest;
import com.cloudform.dto.template.TemplateResponse;
import com.cloudform.dto.template.TemplateSummary;
import com.cloudform.dto.template.UpdateTemplateRequest;
import com.cloudform.service.ResourceTemplateService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PageableDefault;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/templates")
@Tag(name = "Resource Templates", description = "Resource template CRUD and lifecycle")
public class ResourceTemplateController {

    private final ResourceTemplateService service;

    public ResourceTemplateController(ResourceTemplateService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<PageResponse<TemplateSummary>> list(
            @RequestParam(required = false) CloudProvider provider,
            @RequestParam(required = false) TemplateStatus status,
            @RequestParam(required = false) ResourceType resourceType,
            @RequestParam(required = false) String search,
            @PageableDefault(size = 20) Pageable pageable) {
        Page<ResourceTemplate> page = service.findAll(provider, status, resourceType, search, pageable);
        return ApiResponse.ok(PageResponse.from(page, TemplateSummary::from));
    }

    @GetMapping("/{id}")
    public ApiResponse<TemplateResponse> get(@PathVariable UUID id) {
        return ApiResponse.ok(TemplateResponse.from(service.findById(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<TemplateResponse>> create(@Valid @RequestBody CreateTemplateRequest req) {
        ResourceTemplate created = service.create(req);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(TemplateResponse.from(created), "Template created"));
    }

    @PutMapping("/{id}")
    public ApiResponse<TemplateResponse> update(@PathVariable UUID id,
                                                @Valid @RequestBody UpdateTemplateRequest req) {
        return ApiResponse.ok(TemplateResponse.from(service.update(id, req)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/publish")
    public ApiResponse<TemplateResponse> publish(@PathVariable UUID id) {
        return ApiResponse.ok(TemplateResponse.from(service.publish(id)));
    }

    @PostMapping("/{id}/archive")
    public ApiResponse<TemplateResponse> archive(@PathVariable UUID id) {
        return ApiResponse.ok(TemplateResponse.from(service.archive(id)));
    }
}
