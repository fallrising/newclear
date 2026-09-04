package dev.ojbk.config;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public record ConfigEvent(
        int schemaVersion,
        ConfigEntityType entityType,
        String entityId,
        long version,
        Instant updatedAt,
        String updatedBy,
        Map<String, Object> payload) {

    public ConfigEvent {
        if (schemaVersion < 1) {
            throw new IllegalArgumentException("schemaVersion must be positive");
        }
        Objects.requireNonNull(entityType, "entityType");
        if (entityId == null || entityId.isBlank()) {
            throw new IllegalArgumentException("entityId must not be blank");
        }
        if (version < 1) {
            throw new IllegalArgumentException("version must be positive");
        }
        Objects.requireNonNull(updatedAt, "updatedAt");
        if (updatedBy == null || updatedBy.isBlank()) {
            throw new IllegalArgumentException("updatedBy must not be blank");
        }
        payload = Map.copyOf(Objects.requireNonNull(payload, "payload"));
    }
}
