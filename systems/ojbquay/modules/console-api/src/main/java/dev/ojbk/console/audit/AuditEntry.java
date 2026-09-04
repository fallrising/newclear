package dev.ojbk.console.audit;

import java.time.Instant;
import java.util.Map;

public record AuditEntry(
        long id,
        String actor,
        String action,
        String entity,
        String entityId,
        Map<String, Object> detail,
        Instant at) {

    public AuditEntry {
        detail = Map.copyOf(detail);
    }
}
