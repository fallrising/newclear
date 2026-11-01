package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A content type. sortField, visibilityField and ownerField name fields of this type (null = not set):
 * sortField orders public lists, visibilityField holds public/unlisted/private, ownerField is a principal-ref.
 */
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
        Instant updatedAt,
        String sortField,
        String visibilityField,
        String ownerField) {

    /** Type without settings (sortField, visibilityField, ownerField all null). */
    public ContentTypeRecord(
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
        this(id, typeKey, displayName, pluralDisplayName, description, titleField, slugPolicy, singleton, enabled,
                previewable, publicRequiresPublishedRefs, createdAt, updatedAt, null, null, null);
    }

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
                now,
                sortField,
                visibilityField,
                ownerField);
    }

    public ContentTypeRecord withSettings(String sortField, String visibilityField, String ownerField, Instant now) {
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
                now,
                sortField,
                visibilityField,
                ownerField);
    }
}
