package com.cloudform.domain.entity;

import com.cloudform.domain.enums.ComponentType;
import com.cloudform.domain.enums.FormTarget;
import com.cloudform.domain.enums.ValueSource;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.util.UUID;

@Entity
@Table(name = "field_config", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"template_id", "field_key"})
})
public class FieldConfig {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "template_id", nullable = false)
    private ResourceTemplate template;

    @Column(name = "field_key", nullable = false, length = 100)
    private String fieldKey;

    @Column(name = "tf_path", length = 200)
    private String tfPath;

    @Column(name = "display_name", length = 200)
    private String displayName;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "group_key", length = 50)
    private String groupKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "form_target", nullable = false, length = 20)
    private FormTarget formTarget;

    @Enumerated(EnumType.STRING)
    @Column(name = "value_source", nullable = false, length = 20)
    private ValueSource valueSource;

    @Enumerated(EnumType.STRING)
    @Column(name = "component_type", nullable = false, length = 20)
    private ComponentType componentType = ComponentType.INPUT;

    @Column(nullable = false)
    private boolean required;

    @Column(nullable = false)
    private boolean editable = true;

    @Column(name = "display_order", nullable = false)
    private int displayOrder;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "fixed_value_json", columnDefinition = "jsonb")
    private String fixedValueJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "default_value_json", columnDefinition = "jsonb")
    private String defaultValueJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "data_source_json", columnDefinition = "jsonb")
    private String dataSourceJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "validation_json", columnDefinition = "jsonb")
    private String validationJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "depends_on_json", columnDefinition = "jsonb")
    private String dependsOnJson;

    @Column(name = "tf_type", length = 20)
    private String tfType;

    @Column(name = "tf_required")
    private boolean tfRequired;

    @Column(name = "tf_computed")
    private boolean tfComputed;

    @Column(name = "tf_default", columnDefinition = "TEXT")
    private String tfDefault;

    // --- Accessors ---

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public ResourceTemplate getTemplate() { return template; }
    public void setTemplate(ResourceTemplate template) { this.template = template; }

    public String getFieldKey() { return fieldKey; }
    public void setFieldKey(String fieldKey) { this.fieldKey = fieldKey; }

    public String getTfPath() { return tfPath; }
    public void setTfPath(String tfPath) { this.tfPath = tfPath; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getGroupKey() { return groupKey; }
    public void setGroupKey(String groupKey) { this.groupKey = groupKey; }

    public FormTarget getFormTarget() { return formTarget; }
    public void setFormTarget(FormTarget formTarget) { this.formTarget = formTarget; }

    public ValueSource getValueSource() { return valueSource; }
    public void setValueSource(ValueSource valueSource) { this.valueSource = valueSource; }

    public ComponentType getComponentType() { return componentType; }
    public void setComponentType(ComponentType componentType) { this.componentType = componentType; }

    public boolean isRequired() { return required; }
    public void setRequired(boolean required) { this.required = required; }

    public boolean isEditable() { return editable; }
    public void setEditable(boolean editable) { this.editable = editable; }

    public int getDisplayOrder() { return displayOrder; }
    public void setDisplayOrder(int displayOrder) { this.displayOrder = displayOrder; }

    public String getFixedValueJson() { return fixedValueJson; }
    public void setFixedValueJson(String fixedValueJson) { this.fixedValueJson = fixedValueJson; }

    public String getDefaultValueJson() { return defaultValueJson; }
    public void setDefaultValueJson(String defaultValueJson) { this.defaultValueJson = defaultValueJson; }

    public String getDataSourceJson() { return dataSourceJson; }
    public void setDataSourceJson(String dataSourceJson) { this.dataSourceJson = dataSourceJson; }

    public String getValidationJson() { return validationJson; }
    public void setValidationJson(String validationJson) { this.validationJson = validationJson; }

    public String getDependsOnJson() { return dependsOnJson; }
    public void setDependsOnJson(String dependsOnJson) { this.dependsOnJson = dependsOnJson; }

    public String getTfType() { return tfType; }
    public void setTfType(String tfType) { this.tfType = tfType; }

    public boolean isTfRequired() { return tfRequired; }
    public void setTfRequired(boolean tfRequired) { this.tfRequired = tfRequired; }

    public boolean isTfComputed() { return tfComputed; }
    public void setTfComputed(boolean tfComputed) { this.tfComputed = tfComputed; }

    public String getTfDefault() { return tfDefault; }
    public void setTfDefault(String tfDefault) { this.tfDefault = tfDefault; }
}
