package com.cloudform.service;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.dto.field.FieldConfigUpdateRequest;
import com.cloudform.repository.FieldConfigRepository;
import com.cloudform.web.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Transactional
public class FieldConfigService {

    private final FieldConfigRepository repository;
    private final ResourceTemplateService templateService;

    public FieldConfigService(FieldConfigRepository repository, ResourceTemplateService templateService) {
        this.repository = repository;
        this.templateService = templateService;
    }

    @Transactional(readOnly = true)
    public List<FieldConfig> listByTemplate(UUID templateId) {
        templateService.findById(templateId);
        return repository.findByTemplateIdOrderByDisplayOrderAsc(templateId);
    }

    public FieldConfig upsert(UUID templateId, FieldConfigUpdateRequest req) {
        ResourceTemplate template = templateService.findById(templateId);
        FieldConfig field = repository.findByTemplateIdAndFieldKey(templateId, req.fieldKey())
                .orElseGet(() -> {
                    FieldConfig f = new FieldConfig();
                    f.setTemplate(template);
                    f.setFieldKey(req.fieldKey());
                    return f;
                });
        applyUpdate(field, req);
        return repository.save(field);
    }

    public List<FieldConfig> batchUpsert(UUID templateId, List<FieldConfigUpdateRequest> requests) {
        ResourceTemplate template = templateService.findById(templateId);
        List<FieldConfig> saved = new java.util.ArrayList<>();
        for (FieldConfigUpdateRequest req : requests) {
            FieldConfig field = repository.findByTemplateIdAndFieldKey(templateId, req.fieldKey())
                    .orElseGet(() -> {
                        FieldConfig f = new FieldConfig();
                        f.setTemplate(template);
                        f.setFieldKey(req.fieldKey());
                        return f;
                    });
            applyUpdate(field, req);
            saved.add(repository.save(field));
        }
        return saved;
    }

    public void deleteByFieldKey(UUID templateId, String fieldKey) {
        FieldConfig field = repository.findByTemplateIdAndFieldKey(templateId, fieldKey)
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Field not found: " + templateId + " / " + fieldKey));
        repository.delete(field);
    }

    public void resetForTemplate(UUID templateId) {
        templateService.findById(templateId);
        repository.deleteByTemplateId(templateId);
    }

    private void applyUpdate(FieldConfig field, FieldConfigUpdateRequest req) {
        field.setTfPath(req.tfPath());
        field.setDisplayName(req.displayName());
        field.setDescription(req.description());
        field.setGroupKey(req.groupKey());
        field.setFormTarget(req.formTarget());
        field.setValueSource(req.valueSource());
        field.setComponentType(req.componentType());
        field.setRequired(req.required());
        field.setEditable(req.editable());
        field.setDisplayOrder(req.displayOrder());
        field.setFixedValueJson(req.fixedValueJson());
        field.setDefaultValueJson(req.defaultValueJson());
        field.setDataSourceJson(req.dataSourceJson());
        field.setValidationJson(req.validationJson());
        field.setDependsOnJson(req.dependsOnJson());
    }
}
