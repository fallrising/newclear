package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class EntryController {

    public record EntryWriteBody(String slug, Map<String, Object> payload, Integer version) {}

    private final EntryService entries;
    private final ContentStore store;

    public EntryController(EntryService entries, ContentStore store) {
        this.entries = entries;
        this.store = store;
    }

    @GetMapping("/content-types")
    public Map<String, Object> types(HttpServletRequest request) {
        rejectFront(request);
        return Map.of("items", store.listTypes().stream().filter(ContentTypeRecord::enabled).map(this::typeJson).toList());
    }

    @GetMapping("/content-types/{typeKey}")
    public Map<String, Object> type(@PathVariable String typeKey, HttpServletRequest request) {
        rejectFront(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(com.fallrising.cms.content.ContentException::typeNotFound);
        return typeJson(type);
    }

    @GetMapping("/content-types/{typeKey}/entries")
    public Map<String, Object> list(
            @PathVariable String typeKey,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String q,
            HttpServletRequest request) {
        IdentityRequest identity = work(request, CmsAction.READ_DRAFT, typeKey);
        List<String> states = state == null || state.isBlank()
                ? List.of()
                : Arrays.stream(state.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
        String refField = null;
        UUID refTarget = null;
        for (String name : request.getParameterMap().keySet()) {
            if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
                refField = name.substring(4);
                refTarget = parseRefTarget(name, request.getParameter(name));
            }
        }
        List<Map<String, Object>> items = entries.listWork(
                        identity.principal(), identity.surface(), typeKey, states, q, refField, refTarget)
                .stream()
                .map(ContentProjection::work)
                .toList();
        return Map.of("items", items, "total", items.size(), "offset", 0, "limit", items.size());
    }

    @PostMapping("/content-types/{typeKey}/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @PathVariable String typeKey, @RequestBody(required = false) EntryWriteBody body, HttpServletRequest request) {
        IdentityRequest identity = work(request, CmsAction.CREATE, typeKey);
        EntryWriteBody write = body == null ? new EntryWriteBody(null, Map.of(), null) : body;
        EntryRecord created = entries.create(
                identity.principal(), identity.surface(), typeKey, write.slug(), write.payload());
        return ContentProjection.work(created);
    }

    @GetMapping("/entries/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        EntryRecord entry = entries.getWork(identity.principal(), identity.surface(), id);
        return ContentProjection.work(entry);
    }

    @PatchMapping("/entries/{id}")
    public Map<String, Object> patch(
            @PathVariable UUID id, @RequestBody EntryWriteBody body, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        EntryRecord updated = entries.patch(
                identity.principal(), identity.surface(), id, body.slug(), body.payload(), body.version());
        return ContentProjection.work(updated);
    }

    @PostMapping("/entries/{id}/publish")
    public Map<String, Object> publish(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.publish(identity.principal(), identity.surface(), id));
    }

    @PostMapping("/entries/{id}/unpublish")
    public Map<String, Object> unpublish(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.unpublish(identity.principal(), identity.surface(), id));
    }

    @PostMapping("/entries/{id}/archive")
    public Map<String, Object> archive(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.archive(identity.principal(), identity.surface(), id));
    }

    @PostMapping("/entries/{id}/restore")
    public Map<String, Object> restore(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.restore(identity.principal(), identity.surface(), id));
    }

    @DeleteMapping("/entries/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        entries.softDelete(identity.principal(), identity.surface(), id);
    }

    @GetMapping("/entries/{id}/revisions")
    public Map<String, Object> revisions(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return Map.of(
                "items",
                entries.revisions(identity.principal(), identity.surface(), id).stream()
                        .map(r -> Map.of(
                                "revisionNo", r.revisionNo(),
                                "slug", r.slug() == null ? "" : r.slug(),
                                "publishedAt", r.publishedAt().toString()))
                        .toList());
    }

    @PostMapping("/entries/{id}/revisions/{revisionNo}/revert")
    public Map<String, Object> revert(@PathVariable UUID id, @PathVariable int revisionNo, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.revert(identity.principal(), identity.surface(), id, revisionNo));
    }

    @GetMapping("/preview/entries/{id}")
    public Map<String, Object> preview(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = rejectFront(request);
        return ContentProjection.work(entries.getWork(identity.principal(), identity.surface(), id));
    }

    private static IdentityRequest work(HttpServletRequest request, CmsAction action, String typeKey) {
        IdentityRequest identity = rejectFront(request);
        if (identity.surface() == Surface.FRONT) {
            throw IdentityException.surfaceForbidden(action.wire(), typeKey, identity.surface().wire());
        }
        return identity;
    }

    private Map<String, Object> typeJson(ContentTypeRecord type) {
        java.util.LinkedHashMap<String, Object> json = new java.util.LinkedHashMap<>();
        json.put("key", type.typeKey());
        json.put("displayName", type.displayName());
        json.put("pluralDisplayName", type.pluralDisplayName());
        json.put("titleField", type.titleField());
        json.put("slugPolicy", type.slugPolicy());
        json.put("fields", store.fieldsOf(type.id()).stream()
                .filter(f -> f.enabled() && !"internal".equals(f.visibility()))
                .map(f -> {
                    java.util.LinkedHashMap<String, Object> field = new java.util.LinkedHashMap<>();
                    field.put("key", f.fieldKey());
                    field.put("type", f.fieldType());
                    field.put("required", f.required());
                    field.put("refTarget", f.refTargetTypeKey());
                    field.put("enumValues", f.enumValues());
                    return field;
                })
                .toList());
        return json;
    }

    private static IdentityRequest rejectFront(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        if (identity.surface() == Surface.FRONT) {
            throw IdentityException.surfaceForbidden("read_draft", null, Surface.FRONT.wire());
        }
        return identity;
    }

    private static UUID parseRefTarget(String name, String raw) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw com.fallrising.cms.content.ContentException.invalidParameter(name + " must be a UUID");
        }
    }
}
