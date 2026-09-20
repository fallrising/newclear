package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ContentTypeRecord(
        UUID id,
        String typeKey,
        String displayName,
        String pluralDisplayName,
        String description,
        String titleField,
        String slugPolicy,
        boolean singleton,
        boolean enabled,
        boolean previewable,
        List<String> publicRequiresPublishedRefs,
        Instant createdAt,
        Instant updatedAt) {

    public ContentTypeRecord withEnabled(boolean enabled, Instant now) {
        return new ContentTypeRecord(
                id,
                typeKey,
                displayName,
                pluralDisplayName,
                description,
                titleField,
                slugPolicy,
                singleton,
                enabled,
                previewable,
                publicRequiresPublishedRefs,
                createdAt,
                now);
    }
}
