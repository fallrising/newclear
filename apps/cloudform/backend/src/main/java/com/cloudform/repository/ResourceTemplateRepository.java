package com.cloudform.repository;

import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ResourceTemplateRepository extends JpaRepository<ResourceTemplate, UUID> {

    Page<ResourceTemplate> findByCloudProvider(CloudProvider cloudProvider, Pageable pageable);

    Page<ResourceTemplate> findByStatus(TemplateStatus status, Pageable pageable);

    Page<ResourceTemplate> findByCloudProviderAndStatus(CloudProvider cloudProvider, TemplateStatus status, Pageable pageable);

    Page<ResourceTemplate> findByResourceType(ResourceType resourceType, Pageable pageable);

    Optional<ResourceTemplate> findByCloudProviderAndTfResourceName(CloudProvider cloudProvider, String tfResourceName);

    @Query("SELECT t FROM ResourceTemplate t WHERE " +
           "(:provider IS NULL OR t.cloudProvider = :provider) AND " +
           "(:status IS NULL OR t.status = :status) AND " +
           "(:resourceType IS NULL OR t.resourceType = :resourceType) AND " +
           "(:search = '' OR LOWER(t.displayName) LIKE LOWER(CONCAT('%', :search, '%')))")
    Page<ResourceTemplate> findWithFilters(
            @Param("provider") CloudProvider provider,
            @Param("status") TemplateStatus status,
            @Param("resourceType") ResourceType resourceType,
            @Param("search") String search,
            Pageable pageable);
}
