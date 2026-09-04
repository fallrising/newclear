package com.cloudform.domain.entity;

import com.cloudform.domain.enums.RequestStatus;
import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "provisioning_request")
@EntityListeners(AuditingEntityListener.class)
public class ProvisioningRequest {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "request_no", nullable = false, unique = true, length = 20)
    private String requestNo;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "template_id", nullable = false)
    private ResourceTemplate template;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private RequestStatus status = RequestStatus.DRAFT;

    @Column(name = "user_form_data_json", columnDefinition = "jsonb")
    private String userFormDataJson;

    @Column(name = "ops_form_data_json", columnDefinition = "jsonb")
    private String opsFormDataJson;

    @Column(name = "merged_tf_vars_json", columnDefinition = "jsonb")
    private String mergedTfVarsJson;

    @Column(name = "generated_tf", columnDefinition = "TEXT")
    private String generatedTf;

    @Column(name = "tf_execution_id", length = 100)
    private String tfExecutionId;

    @Column(name = "cloud_instance_id", length = 100)
    private String cloudInstanceId;

    @Column(name = "applicant_id", nullable = false, length = 100)
    private String applicantId;

    @Column(name = "applicant_name", length = 100)
    private String applicantName;

    @Column(name = "applicant_team", length = 100)
    private String applicantTeam;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    // --- Accessors ---

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public String getRequestNo() { return requestNo; }
    public void setRequestNo(String requestNo) { this.requestNo = requestNo; }

    public ResourceTemplate getTemplate() { return template; }
    public void setTemplate(ResourceTemplate template) { this.template = template; }

    public RequestStatus getStatus() { return status; }
    public void setStatus(RequestStatus status) { this.status = status; }

    public String getUserFormDataJson() { return userFormDataJson; }
    public void setUserFormDataJson(String userFormDataJson) { this.userFormDataJson = userFormDataJson; }

    public String getOpsFormDataJson() { return opsFormDataJson; }
    public void setOpsFormDataJson(String opsFormDataJson) { this.opsFormDataJson = opsFormDataJson; }

    public String getMergedTfVarsJson() { return mergedTfVarsJson; }
    public void setMergedTfVarsJson(String mergedTfVarsJson) { this.mergedTfVarsJson = mergedTfVarsJson; }

    public String getGeneratedTf() { return generatedTf; }
    public void setGeneratedTf(String generatedTf) { this.generatedTf = generatedTf; }

    public String getTfExecutionId() { return tfExecutionId; }
    public void setTfExecutionId(String tfExecutionId) { this.tfExecutionId = tfExecutionId; }

    public String getCloudInstanceId() { return cloudInstanceId; }
    public void setCloudInstanceId(String cloudInstanceId) { this.cloudInstanceId = cloudInstanceId; }

    public String getApplicantId() { return applicantId; }
    public void setApplicantId(String applicantId) { this.applicantId = applicantId; }

    public String getApplicantName() { return applicantName; }
    public void setApplicantName(String applicantName) { this.applicantName = applicantName; }

    public String getApplicantTeam() { return applicantTeam; }
    public void setApplicantTeam(String applicantTeam) { this.applicantTeam = applicantTeam; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }

    public LocalDateTime getCompletedAt() { return completedAt; }
    public void setCompletedAt(LocalDateTime completedAt) { this.completedAt = completedAt; }
}
