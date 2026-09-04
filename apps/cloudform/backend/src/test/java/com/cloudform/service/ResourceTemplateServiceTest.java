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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.PageImpl;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ResourceTemplateServiceTest {

    private ResourceTemplateRepository repository;
    private ResourceTemplateService service;

    @BeforeEach
    void setUp() {
        repository = mock(ResourceTemplateRepository.class);
        service = new ResourceTemplateService(repository);
    }

    @Test
    void createPersistsDraftTemplate() {
        when(repository.findByCloudProviderAndTfResourceName(any(), any())).thenReturn(Optional.empty());
        when(repository.save(any(ResourceTemplate.class))).thenAnswer(inv -> {
            ResourceTemplate t = inv.getArgument(0);
            t.setId(UUID.randomUUID());
            return t;
        });

        ResourceTemplate created = service.create(new CreateTemplateRequest(
                CloudProvider.ALIYUN, ResourceType.RDS, "alicloud_db_instance",
                "1.230.0", "Alicloud RDS", "desc", "database"));

        assertThat(created.getStatus()).isEqualTo(TemplateStatus.DRAFT);
        assertThat(created.getTfProviderVersion()).isEqualTo("1.230.0");
        verify(repository).save(any(ResourceTemplate.class));
    }

    @Test
    void createRejectsDuplicate() {
        when(repository.findByCloudProviderAndTfResourceName(CloudProvider.ALIYUN, "alicloud_db_instance"))
                .thenReturn(Optional.of(new ResourceTemplate()));

        assertThatThrownBy(() -> service.create(new CreateTemplateRequest(
                CloudProvider.ALIYUN, ResourceType.RDS, "alicloud_db_instance",
                "1.230.0", "Alicloud RDS", null, null)))
                .isInstanceOf(InvalidStateException.class);
    }

    @Test
    void findByIdThrowsWhenMissing() {
        UUID id = UUID.randomUUID();
        when(repository.findById(id)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.findById(id))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void updateAppliesNonNullFields() {
        UUID id = UUID.randomUUID();
        ResourceTemplate existing = new ResourceTemplate();
        existing.setId(id);
        existing.setDisplayName("Original");
        existing.setStatus(TemplateStatus.DRAFT);
        when(repository.findById(id)).thenReturn(Optional.of(existing));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ResourceTemplate updated = service.update(id, new UpdateTemplateRequest("New name", null, "icon-x"));

        assertThat(updated.getDisplayName()).isEqualTo("New name");
        assertThat(updated.getIcon()).isEqualTo("icon-x");
    }

    @Test
    void updateRejectsArchived() {
        UUID id = UUID.randomUUID();
        ResourceTemplate existing = new ResourceTemplate();
        existing.setStatus(TemplateStatus.ARCHIVED);
        when(repository.findById(id)).thenReturn(Optional.of(existing));

        assertThatThrownBy(() -> service.update(id, new UpdateTemplateRequest("X", null, null)))
                .isInstanceOf(InvalidStateException.class);
    }

    @Test
    void deleteAllowsOnlyDraft() {
        UUID id = UUID.randomUUID();
        ResourceTemplate t = new ResourceTemplate();
        t.setStatus(TemplateStatus.PUBLISHED);
        when(repository.findById(id)).thenReturn(Optional.of(t));

        assertThatThrownBy(() -> service.delete(id)).isInstanceOf(InvalidStateException.class);

        t.setStatus(TemplateStatus.DRAFT);
        service.delete(id);
        verify(repository).delete(t);
    }

    @Test
    void publishTransitionsToPublished() {
        UUID id = UUID.randomUUID();
        ResourceTemplate t = new ResourceTemplate();
        t.setStatus(TemplateStatus.DRAFT);
        when(repository.findById(id)).thenReturn(Optional.of(t));
        when(repository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        ResourceTemplate result = service.publish(id);
        assertThat(result.getStatus()).isEqualTo(TemplateStatus.PUBLISHED);
    }

    @Test
    void findAllForwardsFilters() {
        Pageable pageable = PageRequest.of(0, 10);
        Page<ResourceTemplate> empty = new PageImpl<>(List.of());
        when(repository.findWithFilters(CloudProvider.ALIYUN, TemplateStatus.DRAFT, null, "rds", pageable))
                .thenReturn(empty);

        Page<ResourceTemplate> result = service.findAll(CloudProvider.ALIYUN, TemplateStatus.DRAFT, null, "rds", pageable);
        assertThat(result).isEqualTo(empty);
        verify(repository).findWithFilters(CloudProvider.ALIYUN, TemplateStatus.DRAFT, null, "rds", pageable);
    }
}
