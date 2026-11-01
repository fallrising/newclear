package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Writes audit events for content, schema, settings, media and role changes (02 §4.6, B-07). Callers run it inside
 * the same TransactionRunner block as the change. Identity events (login, principals) keep their own writers.
 */
@Component
public class AuditLog {

    public static final String OK = "ok";
    public static final String DENIED = "denied";

    private final IdentityStore store;
    private final ObjectMapper objectMapper;

    public AuditLog(IdentityStore store, ObjectMapper objectMapper) {
        this.store = store;
        this.objectMapper = objectMapper;
    }

    /** detail may be null; otherwise it is stored as a JSON object. */
    public void record(Principal actor, Surface surface, String category, String action, String targetType, UUID targetId,
            String outcome, Map<String, Object> detail) {
        store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), actor == null ? null : actor.id(), category,
                action, targetType, targetId, surface == null ? null : surface.wire(), outcome, null, json(detail)));
    }

    private String json(Map<String, Object> detail) {
        if (detail == null) return null;
        try {
            return objectMapper.writeValueAsString(detail);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
