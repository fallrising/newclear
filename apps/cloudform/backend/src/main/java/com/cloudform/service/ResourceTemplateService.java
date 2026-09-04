package com.cloudform.service;

import com.cloudform.domain.entity.ResourceTemplate;
import com.cloudform.domain.enums.CloudProvider;
import com.cloudform.domain.enums.ResourceType;
import com.cloudform.domain.enums.TemplateStatus;
import com.cloudform.dto.template.CreateTemplateRequest;
import com.cloudform.dto.template.UpdateTemplateRequest;
import com.cloudform.repository.ResourceTemplateRepository;
import com.cloudform.web.InvalidStateException;
import com.cloudform.web.ResourceNotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
@Transactional
public class ResourceTemplateService {

    private final ResourceTemplateRepository repository;

    public ResourceTemplateService(ResourceTemplateRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public Page<ResourceTemplate> findAll(CloudProvider provider, TemplateStatus status,
                                          ResourceType resourceType, String search, Pageable pageable) {
        return repository.findWithFilters(provider, status, resourceType, search == null ? "" : search, pageable);
    }

    @Transactional(readOnly = true)
    public ResourceTemplate findById(UUID id) {
        return repository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Template not found: " + id));
    }

    public ResourceTemplate create(CreateTemplateRequest req) {
        repository.findByCloudProviderAndTfResourceName(req.cloudProvider(), req.tfResourceName())
                .ifPresent(existing -> {
                    throw new InvalidStateException(
                            "Template already exists for " + req.cloudProvider() + "/" + req.tfResourceName());
                });

        ResourceTemplate t = new ResourceTemplate();
        t.setCloudProvider(req.cloudProvider());
        t.setResourceType(req.resourceType());
        t.setTfResourceName(req.tfResourceName());
        t.setTfProviderVersion(req.tfProviderVersion());
        t.setDisplayName(req.displayName());
        t.setDescription(req.description());
        t.setIcon(req.icon());
        t.setStatus(TemplateStatus.DRAFT);
        return repository.save(t);
    }

    public ResourceTemplate update(UUID id, UpdateTemplateRequest req) {
        ResourceTemplate t = findById(id);
        if (t.getStatus() == TemplateStatus.ARCHIVED) {
            throw new InvalidStateException("Cannot update an archived template");
        }
        if (req.displayName() != null) t.setDisplayName(req.displayName());
        if (req.description() != null) t.setDescription(req.description());
        if (req.icon() != null) t.setIcon(req.icon());
        return repository.save(t);
    }

    public void delete(UUID id) {
        ResourceTemplate t = findById(id);
        if (t.getStatus() != TemplateStatus.DRAFT) {
            throw new InvalidStateException("Only DRAFT templates can be deleted");
        }
        repository.delete(t);
    }

    public ResourceTemplate publish(UUID id) {
        ResourceTemplate t = findById(id);
        if (t.getStatus() == TemplateStatus.ARCHIVED) {
            throw new InvalidStateException("Cannot publish an archived template");
        }
        t.setStatus(TemplateStatus.PUBLISHED);
        return repository.save(t);
    }

    public ResourceTemplate archive(UUID id) {
        ResourceTemplate t = findById(id);
        t.setStatus(TemplateStatus.ARCHIVED);
        return repository.save(t);
    }
}
