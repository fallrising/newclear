package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditPage;
import com.fallrising.cms.identity.domain.AuditQuery;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * GET /admin/audit and /admin/audit/{id} (02 §4.6, B-07). Needs read_audit (Admin surface only, by the hard-deny sets).
 * Query parameters: page (≥ 1, default 1), size (1..100, default 20), from (inclusive) and to (exclusive) as ISO-8601
 * date-times with offset, actor (username; unknown → empty page), action (exact; a value ending with "." is a prefix),
 * category, targetType, targetId (UUID), outcome. Blank values mean "no condition"; other parameters are ignored.
 * Every rejected value is 400 VALIDATION_FAILED.
 */
@Service
public class AuditSearch {

    private final IdentityStore store;
    private final AuthorizationService authorization;
    private final ObjectMapper objectMapper;

    public AuditSearch(IdentityStore store, AuthorizationService authorization, ObjectMapper objectMapper) {
        this.store = store;
        this.authorization = authorization;
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> search(IdentityRequest request, Map<String, String[]> params) {
        authorization.require(request.principal(), CmsAction.READ_AUDIT, null, null, request.surface());
        int page = intParam(params, "page", 1, 1, Integer.MAX_VALUE);
        int size = intParam(params, "size", 20, 1, 100);
        String actorName = text(params, "actor");
        String action = text(params, "action");
        Instant from = instant(params, "from");
        Instant to = instant(params, "to");
        String category = text(params, "category");
        String targetType = text(params, "targetType");
        UUID targetId = uuid(params, "targetId");
        String outcome = text(params, "outcome");
        UUID actorId = null;
        if (actorName != null) {
            Optional<Principal> actor = store.findPrincipalByUsername(actorName);
            if (actor.isEmpty()) return page(List.of(), 0, page, size);
            actorId = actor.get().id();
        }
        AuditPage result = store.queryAudits(new AuditQuery(from, to, actorId, action,
                action != null && action.endsWith("."), category, targetType, targetId, outcome, page, size));
        Map<UUID, Map<String, Object>> actors = new HashMap<>();
        List<Map<String, Object>> items = result.items().stream().map(e -> item(e, actors)).toList();
        return page(items, result.total(), page, size);
    }

    public Map<String, Object> get(IdentityRequest request, UUID id) {
        authorization.require(request.principal(), CmsAction.READ_AUDIT, null, null, request.surface());
        AuditEvent event = store.findAudit(id).orElseThrow(IdentityException::auditNotFound);
        Map<String, Object> json = item(event, new HashMap<>());
        json.put("detail", detail(event.detailJson()));
        return json;
    }

    private Map<String, Object> item(AuditEvent event, Map<UUID, Map<String, Object>> actors) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", event.id().toString());
        json.put("at", event.at());
        json.put("actor", event.actorPrincipalId() == null ? null
                : actors.computeIfAbsent(event.actorPrincipalId(), this::actor));
        json.put("category", event.category());
        json.put("action", event.action());
        json.put("targetType", event.targetType());
        json.put("targetId", event.targetId() == null ? null : event.targetId().toString());
        json.put("surface", event.surface());
        json.put("outcome", event.outcome());
        return json;
    }

    /** { id, username, displayName }; a principal that no longer exists keeps only its id (username and displayName null). */
    private Map<String, Object> actor(UUID id) {
        Map<String, Object> json = new LinkedHashMap<>();
        Principal principal = store.findPrincipalById(id).orElse(null);
        json.put("id", id.toString());
        json.put("username", principal == null ? null : principal.username());
        json.put("displayName", principal == null ? null : principal.displayName());
        return json;
    }

    private Object detail(String raw) {
        if (raw == null) return null;
        try {
            return objectMapper.readValue(raw, Map.class);
        } catch (Exception e) {
            return null;
        }
    }

    private static Map<String, Object> page(List<Map<String, Object>> items, long total, int page, int size) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("items", items);
        json.put("total", total);
        json.put("page", page);
        json.put("size", size);
        json.put("offset", (page - 1L) * size);
        json.put("limit", size);
        return json;
    }

    private static String text(Map<String, String[]> params, String name) {
        String[] values = params.get(name);
        if (values == null || values.length == 0) return null;
        if (values.length > 1) throw IdentityException.validation(name + " must not repeat");
        return values[0] == null || values[0].isBlank() ? null : values[0].trim();
    }

    private static int intParam(Map<String, String[]> params, String name, int fallback, int min, int max) {
        String raw = text(params, name);
        if (raw == null) return fallback;
        try {
            if (!raw.matches("[0-9]+")) throw new NumberFormatException();
            int value = Integer.parseInt(raw);
            if (value < min || value > max) throw new NumberFormatException();
            return value;
        } catch (NumberFormatException e) {
            throw IdentityException.validation(max == Integer.MAX_VALUE
                    ? name + " must be a positive integer"
                    : name + " must be an integer from " + min + " to " + max);
        }
    }

    private static Instant instant(Map<String, String[]> params, String name) {
        String raw = text(params, name);
        if (raw == null) return null;
        try {
            return Instant.parse(raw);
        } catch (DateTimeParseException e) {
            try {
                return OffsetDateTime.parse(raw).toInstant();
            } catch (DateTimeParseException e2) {
                throw IdentityException.validation(name + " must be an ISO-8601 date-time with offset");
            }
        }
    }

    private static UUID uuid(Map<String, String[]> params, String name) {
        String raw = text(params, name);
        if (raw == null) return null;
        try {
            UUID value = UUID.fromString(raw);
            if (!value.toString().equalsIgnoreCase(raw)) throw new IllegalArgumentException();
            return value;
        } catch (IllegalArgumentException e) {
            throw IdentityException.validation(name + " must be a UUID");
        }
    }
}
