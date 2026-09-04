package com.cloudform.generation;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.FormTarget;
import com.cloudform.domain.enums.ValueSource;
import com.cloudform.generation.dto.FieldDefinitionDto;
import com.cloudform.generation.dto.FixedFieldDto;
import com.cloudform.generation.dto.FormConfigDto;
import com.cloudform.generation.dto.FormDefinitionDto;
import com.cloudform.generation.dto.FormSectionDto;
import com.cloudform.generation.dto.FormsDto;
import com.cloudform.generation.dto.MetadataDto;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public class FormConfigGenerator {
    private static final Logger log = LoggerFactory.getLogger(FormConfigGenerator.class);
    private static final String VERSION = "1.0";
    private static final String DEFAULT_GROUP = "default";

    private final ObjectMapper objectMapper;

    public FormConfigGenerator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public FormConfigDto generate(ResourceTemplate template, List<FieldConfig> fields) {
        MetadataDto metadata = buildMetadata(template);

        List<FieldConfig> userFields = new ArrayList<>();
        List<FieldConfig> opsFields = new ArrayList<>();
        List<FieldConfig> fixedHidden = new ArrayList<>();
        for (FieldConfig f : fields) {
            switch (f.getFormTarget()) {
                case USER_FORM -> userFields.add(f);
                case OPS_FORM -> opsFields.add(f);
                case HIDDEN -> {
                    if (f.getValueSource() == ValueSource.FIXED) fixedHidden.add(f);
                    else log.warn("HIDDEN field '{}' has non-FIXED valueSource {}; skipped", f.getFieldKey(), f.getValueSource());
                }
                case RESULT_ONLY -> {
                    // TODO: M3+ — surface as a result-only section.
                }
            }
        }

        FormDefinitionDto userForm = buildForm(userFields, "User Form", null);
        FormDefinitionDto opsForm = buildForm(opsFields, "OPs Form", null);
        List<FixedFieldDto> fixedFields = fixedHidden.stream()
                .filter(f -> f.getFixedValueJson() != null && !f.getFixedValueJson().isBlank())
                .map(this::toFixedField)
                .toList();

        return new FormConfigDto(VERSION, metadata, new FormsDto(userForm, opsForm, fixedFields));
    }

    private MetadataDto buildMetadata(ResourceTemplate t) {
        return new MetadataDto(
                t.getResourceType() != null ? t.getResourceType().name() : null,
                t.getCloudProvider() != null ? t.getCloudProvider().name() : null,
                t.getTfResourceName(),
                t.getTfProviderVersion(),
                t.getDisplayName(),
                t.getDescription(),
                t.getIcon(),
                t.getUpdatedAt()
        );
    }

    private FormDefinitionDto buildForm(List<FieldConfig> fields, String title, String description) {
        if (fields.isEmpty()) return new FormDefinitionDto(title, description, List.of());

        Map<String, List<FieldConfig>> grouped = new LinkedHashMap<>();
        for (FieldConfig f : fields) {
            String key = f.getGroupKey() != null ? f.getGroupKey() : DEFAULT_GROUP;
            grouped.computeIfAbsent(key, k -> new ArrayList<>()).add(f);
        }

        List<FormSectionDto> sections = new ArrayList<>();
        for (Map.Entry<String, List<FieldConfig>> entry : grouped.entrySet()) {
            List<FieldConfig> bucket = entry.getValue();
            bucket.sort(Comparator.comparingInt(FieldConfig::getDisplayOrder));
            int sectionOrder = bucket.stream().mapToInt(FieldConfig::getDisplayOrder).min().orElse(0);
            List<FieldDefinitionDto> defs = bucket.stream().map(this::toFieldDefinition).toList();
            sections.add(new FormSectionDto(entry.getKey(), null, null, sectionOrder, defs));
        }
        sections.sort(Comparator.comparingInt(FormSectionDto::order));
        return new FormDefinitionDto(title, description, sections);
    }

    private FieldDefinitionDto toFieldDefinition(FieldConfig f) {
        return new FieldDefinitionDto(
                f.getFieldKey(),
                f.getTfPath(),
                f.getDisplayName(),
                f.getDescription(),
                f.getComponentType() != null ? f.getComponentType().name() : null,
                f.isRequired(),
                f.isEditable(),
                f.getDisplayOrder(),
                parseJson(f.getDataSourceJson(), f.getFieldKey(), "dataSourceJson"),
                parseJson(f.getValidationJson(), f.getFieldKey(), "validationJson"),
                parseDependsOn(f.getDependsOnJson(), f.getFieldKey()),
                parseJson(f.getDefaultValueJson(), f.getFieldKey(), "defaultValueJson")
        );
    }

    private FixedFieldDto toFixedField(FieldConfig f) {
        return new FixedFieldDto(
                f.getFieldKey(),
                f.getTfPath(),
                f.getValueSource() != null ? f.getValueSource().name() : null,
                parseJson(f.getFixedValueJson(), f.getFieldKey(), "fixedValueJson"),
                f.getDescription()
        );
    }

    private Object parseJson(String raw, String fieldKey, String columnName) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return objectMapper.readValue(raw, Object.class);
        } catch (Exception e) {
            log.warn("Field '{}' has invalid {}: {}", fieldKey, columnName, e.getMessage());
            return null;
        }
    }

    private List<String> parseDependsOn(String raw, String fieldKey) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return objectMapper.readValue(raw, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            log.warn("Field '{}' has invalid dependsOnJson: {}", fieldKey, e.getMessage());
            return null;
        }
    }
}
