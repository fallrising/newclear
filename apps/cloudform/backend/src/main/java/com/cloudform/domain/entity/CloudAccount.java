package com.cloudform.domain.entity;

import com.cloudform.domain.enums.CloudProvider;
import jakarta.persistence.*;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.time.LocalDateTime;
import java.util.UUID;

@Entity
@Table(name = "cloud_account", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"provider", "account_id"})
})
@EntityListeners(AuditingEntityListener.class)
public class CloudAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CloudProvider provider;

    @Column(name = "account_id", nullable = false, length = 100)
    private String accountId;

    @Column(name = "account_name", nullable = false, length = 200)
    private String accountName;

    @Column(name = "access_key_id", length = 200)
    private String accessKeyId;

    @Column(name = "access_key_secret", length = 200)
    private String accessKeySecret;

    @Column(nullable = false)
    private boolean active = true;

    @CreatedDate
    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;

    // --- Accessors ---

    public UUID getId() { return id; }
    public void setId(UUID id) { this.id = id; }

    public CloudProvider getProvider() { return provider; }
    public void setProvider(CloudProvider provider) { this.provider = provider; }

    public String getAccountId() { return accountId; }
    public void setAccountId(String accountId) { this.accountId = accountId; }

    public String getAccountName() { return accountName; }
    public void setAccountName(String accountName) { this.accountName = accountName; }

    public String getAccessKeyId() { return accessKeyId; }
    public void setAccessKeyId(String accessKeyId) { this.accessKeyId = accessKeyId; }

    public String getAccessKeySecret() { return accessKeySecret; }
    public void setAccessKeySecret(String accessKeySecret) { this.accessKeySecret = accessKeySecret; }

    public boolean isActive() { return active; }
    public void setActive(boolean active) { this.active = active; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
