package com.cloudform.generation;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.generation.dto.FormConfigDto;
import com.cloudform.generation.dto.GenerationResponse;
import com.cloudform.generation.dto.RequiredApiDto;
import com.cloudform.repository.ResourceTemplateRepository;
import com.cloudform.service.FieldConfigService;
import com.cloudform.service.ResourceTemplateService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
public class GenerationService {

    private final ResourceTemplateService templateService;
    private final ResourceTemplateRepository templateRepository;
    private final FieldConfigService fieldConfigService;
    private final FormConfigGenerator formConfigGenerator;
    private final TfTemplateGenerator tfTemplateGenerator;
    private final RequiredApisExtractor requiredApisExtractor;
    private final ObjectMapper objectMapper;

    public GenerationService(
            ResourceTemplateService templateService,
            ResourceTemplateRepository templateRepository,
            FieldConfigService fieldConfigService,
            FormConfigGenerator formConfigGenerator,
            TfTemplateGenerator tfTemplateGenerator,
            RequiredApisExtractor requiredApisExtractor,
            ObjectMapper objectMapper
    ) {
        this.templateService = templateService;
        this.templateRepository = templateRepository;
        this.fieldConfigService = fieldConfigService;
        this.formConfigGenerator = formConfigGenerator;
        this.tfTemplateGenerator = tfTemplateGenerator;
        this.requiredApisExtractor = requiredApisExtractor;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public GenerationResponse generate(UUID templateId) {
        ResourceTemplate template = templateService.findById(templateId);
        List<FieldConfig> fields = fieldConfigService.listByTemplate(templateId);

        FormConfigDto formConfig = formConfigGenerator.generate(template, fields);
        String tf = tfTemplateGenerator.generate(template, fields);
        List<RequiredApiDto> apis = requiredApisExtractor.extract(fields);

        try {
            template.setFormConfigJson(objectMapper.writeValueAsString(formConfig));
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize FormConfig", e);
        }
        template.setTfTemplate(tf);
        templateRepository.save(template);

        return new GenerationResponse(formConfig, tf, apis);
    }
}
