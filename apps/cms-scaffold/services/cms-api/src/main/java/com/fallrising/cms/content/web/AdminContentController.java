package com.fallrising.cms.content.web;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.service.NavigationService;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminContentController {

    public record FieldBody(String key, String type, Boolean required, Boolean indexed, String refTarget, List<String> enumValues) {}

    public record TypeBody(
            String key, String displayName, String pluralDisplayName, String titleField, String slugPolicy, List<FieldBody> fields) {}

    public record NavBody(Map<String, Object> document) {}

    private final ContentStore store;
    private final NavigationService navigation;
    private final EntryService entries;
    private final IdentityStore identityStore;
    private final com.fallrising.cms.identity.service.AuthorizationService authorization;

    public AdminContentController(
            ContentStore store,
            NavigationService navigation,
            EntryService entries,
            IdentityStore identityStore,
            com.fallrising.cms.identity.service.AuthorizationService authorization) {
        this.store = store;
        this.navigation = navigation;
        this.entries = entries;
        this.identityStore = identityStore;
        this.authorization = authorization;
    }

    @GetMapping("/content-types")
    public Map<String, Object> listTypes(HttpServletRequest request) {
        manageTypes(request);
        return Map.of("items", store.listTypes().stream().map(this::typeJson).toList());
    }

    @PostMapping("/content-types")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createType(@RequestBody TypeBody body, HttpServletRequest request) {
        manageTypes(request);
        if (body.key() == null || !body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
            throw ContentException.validation("FIELD_VALIDATION", "Invalid type key");
        }
        if (store.findTypeByKey(body.key()).isPresent()) {
            throw ContentException.validation("FIELD_VALIDATION", "Type already exists");
        }
        Instant now = Instant.now();
        ContentTypeRecord type = new ContentTypeRecord(
                UUID.randomUUID(),
                body.key(),
                body.displayName() == null ? body.key() : body.displayName(),
                body.pluralDisplayName() == null ? body.key() : body.pluralDisplayName(),
                null,
                body.titleField() == null ? "title" : body.titleField(),
                body.slugPolicy() == null ? "optional" : body.slugPolicy(),
                false,
                true,
                true,
                List.of(),
                now,
                now);
        store.insertType(type);
        int order = 0;
        if (body.fields() != null) {
            for (FieldBody field : body.fields()) {
                store.insertField(new FieldRecord(
                        UUID.randomUUID(),
                        type.id(),
                        field.key(),
                        field.type() == null ? "string" : field.type(),
                        Boolean.TRUE.equals(field.required()),
                        false,
                        Boolean.TRUE.equals(field.indexed()),
                        "public",
                        order++,
                        field.refTarget(),
                        "restrict",
                        field.enumValues() == null ? List.of() : field.enumValues(),
                        true,
                        "media-ref".equals(field.type())));
            }
        }
        return typeJson(type);
    }

    @PostMapping("/content-types/{typeKey}/disable")
    public Map<String, Object> disable(@PathVariable String typeKey, HttpServletRequest request) {
        manageTypes(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        ContentTypeRecord updated = type.withEnabled(false, Instant.now());
        store.updateType(updated);
        return typeJson(updated);
    }

    @PostMapping("/content-types/{typeKey}/enable")
    public Map<String, Object> enable(@PathVariable String typeKey, HttpServletRequest request) {
        manageTypes(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        ContentTypeRecord updated = type.withEnabled(true, Instant.now());
        store.updateType(updated);
        return typeJson(updated);
    }

    @GetMapping("/navigation/{menuKey}")
    public Map<String, Object> getNav(@PathVariable String menuKey, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        return navJson(navigation.getWork(identity.principal(), identity.surface(), menuKey));
    }

    @PatchMapping("/navigation/{menuKey}")
    public Map<String, Object> patchNav(
            @PathVariable String menuKey, @RequestBody NavBody body, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        return navJson(navigation.patch(identity.principal(), identity.surface(), menuKey, body.document()));
    }

    @PostMapping("/navigation/{menuKey}/publish")
    public Map<String, Object> publishNav(@PathVariable String menuKey, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        return navJson(navigation.publish(identity.principal(), identity.surface(), menuKey));
    }

    @PostMapping("/entries/{id}/purge")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void purge(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = adminSurface(request);
        entries.purge(identity.principal(), identity.surface(), id);
    }

    @GetMapping("/audit")
    public Map<String, Object> audit(
            @RequestParam(required = false) String action,
            @RequestParam(required = false) UUID targetId,
            HttpServletRequest request) {
        IdentityRequest identity = adminSurface(request);
        authorization.require(identity.principal(), CmsAction.READ_AUDIT, null, null, identity.surface());
        List<Map<String, Object>> items = identityStore.listAudits(action, targetId).stream()
                .map(event -> {
                    Map<String, Object> json = new LinkedHashMap<>();
                    json.put("action", event.action());
                    json.put("targetType", event.targetType());
                    json.put("targetId", event.targetId() == null ? null : event.targetId().toString());
                    json.put("outcome", event.outcome());
                    json.put("at", event.at());
                    return json;
                })
                .toList();
        return Map.of("items", items);
    }

    private void manageTypes(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        authorization.require(identity.principal(), CmsAction.MANAGE_TYPES, null, null, identity.surface());
    }

    private static IdentityRequest adminSurface(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        if (identity.surface() != Surface.ADMIN) {
            throw IdentityException.surfaceForbidden("delete", null, identity.surface().wire());
        }
        return identity;
    }

    private Map<String, Object> typeJson(ContentTypeRecord type) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", type.typeKey());
        json.put("displayName", type.displayName());
        json.put("pluralDisplayName", type.pluralDisplayName());
        json.put("titleField", type.titleField());
        json.put("slugPolicy", type.slugPolicy());
        json.put("enabled", type.enabled());
        List<Map<String, Object>> fields = new ArrayList<>();
        for (FieldRecord field : store.fieldsOf(type.id())) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("key", field.fieldKey());
            item.put("type", field.fieldType());
            item.put("required", field.required());
            item.put("indexed", field.indexed());
            item.put("refTarget", field.refTargetTypeKey());
            fields.add(item);
        }
        json.put("fields", fields);
        return json;
    }

    private static Map<String, Object> navJson(com.fallrising.cms.content.domain.NavigationRecord menu) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", menu.menuKey());
        json.put("publicationState", menu.publicationState());
        json.put("version", menu.version());
        json.put("document", menu.document());
        return json;
    }
}
