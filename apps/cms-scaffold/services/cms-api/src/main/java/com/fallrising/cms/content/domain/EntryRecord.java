package com.fallrising.cms.content.domain;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

public record EntryRecord(
        UUID id,
        UUID contentTypeId,
        String contentTypeKey,
        String slug,
        PublicationState publicationState,
        int version,
        Map<String, Object> payload,
        Map<String, Object> publishedPayload,
        Instant publishedAt,
        Instant archivedAt,
        Instant deletedAt,
        UUID createdBy,
        UUID updatedBy,
        Instant createdAt,
        Instant updatedAt,
        Instant publishRequestedAt,
        UUID publishRequestedBy) {

    /** Compatibility for entries created before publish requests were added. */
    public EntryRecord(UUID id, UUID contentTypeId, String contentTypeKey, String slug, PublicationState publicationState,
            int version, Map<String, Object> payload, Map<String, Object> publishedPayload, Instant publishedAt,
            Instant archivedAt, Instant deletedAt, UUID createdBy, UUID updatedBy, Instant createdAt, Instant updatedAt) {
        this(id, contentTypeId, contentTypeKey, slug, publicationState, version, payload, publishedPayload, publishedAt,
                archivedAt, deletedAt, createdBy, updatedBy, createdAt, updatedAt, null, null);
    }

    public EntryRecord withPublishRequest(Instant at, UUID by) {
        return new EntryRecord(id, contentTypeId, contentTypeKey, slug, publicationState, version, payload, publishedPayload,
                publishedAt, archivedAt, deletedAt, createdBy, updatedBy, createdAt, updatedAt, at, by);
    }

    public boolean deleted() {
        return deletedAt != null;
    }

    public boolean dirty() {
        return publicationState == PublicationState.PUBLISHED && !payloadEqualsPublished();
    }

    private boolean payloadEqualsPublished() {
        Map<String, Object> left = payload == null ? Map.of() : payload;
        Map<String, Object> right = publishedPayload == null ? Map.of() : publishedPayload;
        return left.equals(right);
    }

    public Map<String, Object> payloadCopy() {
        return payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
    }
}
