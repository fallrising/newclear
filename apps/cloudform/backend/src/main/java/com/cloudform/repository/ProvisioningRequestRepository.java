package com.cloudform.repository;

import com.cloudform.domain.entity.ProvisioningRequest;
import com.cloudform.domain.enums.RequestStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface ProvisioningRequestRepository extends JpaRepository<ProvisioningRequest, UUID> {

    Page<ProvisioningRequest> findByApplicantId(String applicantId, Pageable pageable);

    Page<ProvisioningRequest> findByStatus(RequestStatus status, Pageable pageable);

    Optional<ProvisioningRequest> findByRequestNo(String requestNo);

    @Query("SELECT p FROM ProvisioningRequest p WHERE " +
           "(:applicantId IS NULL OR p.applicantId = :applicantId) AND " +
           "(:status IS NULL OR p.status = :status) AND " +
           "(:templateId IS NULL OR p.template.id = :templateId)")
    Page<ProvisioningRequest> findWithFilters(
            @Param("applicantId") String applicantId,
            @Param("status") RequestStatus status,
            @Param("templateId") UUID templateId,
            Pageable pageable);

    @Query("SELECT COALESCE(MAX(CAST(SUBSTRING(p.requestNo, 4) AS int)), 0) FROM ProvisioningRequest p " +
           "WHERE p.requestNo LIKE :prefix")
    int findMaxRequestNoByPrefix(@Param("prefix") String prefix);
}
