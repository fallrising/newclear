package com.cloudform.controller;

import com.cloudform.dto.ApiResponse;
import com.cloudform.generation.GenerationService;
import com.cloudform.generation.dto.GenerationResponse;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/templates/{templateId}")
public class GenerationController {

    private final GenerationService generationService;

    public GenerationController(GenerationService generationService) {
        this.generationService = generationService;
    }

    @PostMapping("/generate")
    public ApiResponse<GenerationResponse> generate(@PathVariable UUID templateId) {
        return ApiResponse.ok(generationService.generate(templateId));
    }
}
