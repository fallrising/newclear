package com.cloudform.repository;

import com.cloudform.domain.entity.FieldConfig;
import com.cloudform.domain.enums.FormTarget;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface FieldConfigRepository extends JpaRepository<FieldConfig, UUID> {

    List<FieldConfig> findByTemplateIdOrderByDisplayOrderAsc(UUID templateId);

    Optional<FieldConfig> findByTemplateIdAndFieldKey(UUID templateId, String fieldKey);

    List<FieldConfig> findByTemplateIdAndFormTarget(UUID templateId, FormTarget formTarget);

    List<FieldConfig> findByTemplateIdAndFormTargetIn(UUID templateId, List<FormTarget> formTargets);

    void deleteByTemplateId(UUID templateId);

    long countByTemplateId(UUID templateId);
}
