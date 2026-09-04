package com.cloudform.domain.entity;

import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "resource_template")
@EntityListeners(AuditingEntityListener.class)
public class ResourceTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "cloud_provider", nullable = false, length = 20)
    private CloudProvider cloudProvider;

    @Enumerated(EnumType.STRING)
    @Column(name = "resource_type", nullable = false, length = 30)
    private ResourceType resourceType;

    @Column(name = "tf_resource_name", nullable = false, length = 100)
    private String tfResourceName;

    @Column(name = "tf_provider_version", length = 50)
    private String tfProviderVersion;

    @Column(name = "display_name", nullable = false, length = 200)
    private String displayName;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(length = 50)
    private String icon;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tf_schema_json", columnDefinition = "jsonb")
    private String tfSchemaJson;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "form_config_json", columnDefinition = "jsonb")
    private String formConfigJson;

    @Column(name = "tf_template", columnDefinition = "TEXT")
    private String tfTemplate;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sync_config_json", columnDefinition = "jsonb")
    private String syncConfigJson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TemplateStatus status = TemplateStatus.DRAFT;

    @Column(name = "created_by", length = 100)
    private String createdBy;

    @Column(name = "updated_by", length = 100)
    private String updatedBy;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Version
    private Long version;

    @OneToMany(mappedBy = "template", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("displayOrder ASC")
    private List<FieldConfig> fieldConfigs = new ArrayList<>();

    // --- Accessors ---

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public CloudProvider getCloudProvider() { return cloudProvider; }
    public void setCloudProvider(CloudProvider cloudProvider) { this.cloudProvider = cloudProvider; }

    public ResourceType getResourceType() { return resourceType; }
    public void setResourceType(ResourceType resourceType) { this.resourceType = resourceType; }

    public String getTfResourceName() { return tfResourceName; }
    public void setTfResourceName(String tfResourceName) { this.tfResourceName = tfResourceName; }

    public String getTfProviderVersion() { return tfProviderVersion; }
    public void setTfProviderVersion(String tfProviderVersion) { this.tfProviderVersion = tfProviderVersion; }

    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }

    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }

    public String getIcon() { return icon; }
    public void setIcon(String icon) { this.icon = icon; }

    public String getTfSchemaJson() { return tfSchemaJson; }
    public void setTfSchemaJson(String tfSchemaJson) { this.tfSchemaJson = tfSchemaJson; }

    public String getFormConfigJson() { return formConfigJson; }
    public void setFormConfigJson(String formConfigJson) { this.formConfigJson = formConfigJson; }

    public String getTfTemplate() { return tfTemplate; }
    public void setTfTemplate(String tfTemplate) { this.tfTemplate = tfTemplate; }

    public String getSyncConfigJson() { return syncConfigJson; }
    public void setSyncConfigJson(String syncConfigJson) { this.syncConfigJson = syncConfigJson; }

    public TemplateStatus getStatus() { return status; }
    public void setStatus(TemplateStatus status) { this.status = status; }

    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String createdBy) { this.createdBy = createdBy; }

    public String getUpdatedBy() { return updatedBy; }
    public void setUpdatedBy(String updatedBy) { this.updatedBy = updatedBy; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    public Long getVersion() { return version; }
    public void setVersion(Long version) { this.version = version; }

    public List<FieldConfig> getFieldConfigs() { return fieldConfigs; }
    public void setFieldConfigs(List<FieldConfig> fieldConfigs) { this.fieldConfigs = fieldConfigs; }

    public void addFieldConfig(FieldConfig fieldConfig) {
        fieldConfigs.add(fieldConfig);
        fieldConfig.setTemplate(this);
    }

    public void removeFieldConfig(FieldConfig fieldConfig) {
        fieldConfigs.remove(fieldConfig);
        fieldConfig.setTemplate(null);
    }
}
