package com.cloudform.controller;

import com.cloudform.dto.ApiResponse;
import com.cloudform.dto.field.BatchFieldUpdateRequest;
import com.cloudform.dto.field.FieldConfigResponse;
import com.cloudform.dto.field.FieldConfigUpdateRequest;
import com.cloudform.service.FieldConfigService;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/templates/{templateId}/fields")
@Tag(name = "Field Configs", description = "Designer-driven per-field configuration")
public class FieldConfigController {

    private final FieldConfigService service;

    public FieldConfigController(FieldConfigService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<FieldConfigResponse>> list(@PathVariable UUID templateId) {
        return ApiResponse.ok(service.listByTemplate(templateId).stream()
                .map(FieldConfigResponse::from).toList());
    }

    @PutMapping("/{fieldKey}")
    public ApiResponse<FieldConfigResponse> upsert(
            @PathVariable UUID templateId,
            @PathVariable String fieldKey,
            @Valid @RequestBody FieldConfigUpdateRequest req) {
        if (!fieldKey.equals(req.fieldKey())) {
            throw new IllegalArgumentException("Path fieldKey does not match body fieldKey");
        }
        return ApiResponse.ok(FieldConfigResponse.from(service.upsert(templateId, req)));
    }

    @PutMapping("/batch")
    public ApiResponse<List<FieldConfigResponse>> batchUpsert(
            @PathVariable UUID templateId,
            @Valid @RequestBody BatchFieldUpdateRequest req) {
        return ApiResponse.ok(service.batchUpsert(templateId, req.fields()).stream()
                .map(FieldConfigResponse::from).toList());
    }

    @DeleteMapping("/{fieldKey}")
    public ApiResponse<Void> delete(@PathVariable UUID templateId, @PathVariable String fieldKey) {
        service.deleteByFieldKey(templateId, fieldKey);
        return ApiResponse.ok(null, "Field deleted");
    }

    @PostMapping("/reset")
    public ApiResponse<Void> reset(@PathVariable UUID templateId) {
        service.resetForTemplate(templateId);
        return ApiResponse.ok(null, "Fields reset");
    }
}
