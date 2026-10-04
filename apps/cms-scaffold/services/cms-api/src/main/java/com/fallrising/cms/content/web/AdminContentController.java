package com.fallrising.cms.content.web;

import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.service.NavigationService;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.platform.TransactionRunner;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/admin")
public class AdminContentController {

    private static final String SCHEMA = "SCHEMA";
    private static final Set<String> FIELD_TYPES =
            Set.of("string", "markdown", "int", "boolean", "datetime", "enum", "ref", "principal-ref", "media-ref");

    public record FieldBody(String key, String type, Boolean required, Boolean indexed, String refTarget, List<String> enumValues) {}

    public record TypeBody(
            String key, String displayName, String pluralDisplayName, String titleField, String slugPolicy, List<FieldBody> fields) {}

    public record NavBody(Map<String, Object> document) {}

    private final ContentStore store;
    private final NavigationService navigation;
    private final EntryService entries;
    private final com.fallrising.cms.identity.service.AuthorizationService authorization;
    private final TransactionRunner transactions;
    private final AuditLog audit;

    public AdminContentController(
            ContentStore store,
            NavigationService navigation,
            EntryService entries,
            com.fallrising.cms.identity.service.AuthorizationService authorization,
            TransactionRunner transactions,
            AuditLog audit) {
        this.store = store;
        this.navigation = navigation;
        this.entries = entries;
        this.authorization = authorization;
        this.transactions = transactions;
        this.audit = audit;
    }

    @GetMapping("/content-types")
    public Map<String, Object> listTypes(HttpServletRequest request) {
        manageTypes(request);
        return Map.of("items", store.listTypes().stream().map(this::typeJson).toList());
    }

    @PostMapping("/content-types")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createType(@RequestBody TypeBody body, HttpServletRequest request) {
        IdentityRequest identity = manageTypes(request);
        List<FieldError> errors = validateType(body);
        if (!errors.isEmpty()) throw ContentException.fieldErrors(errors);
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
        transactions.run(() -> {
            store.insertType(type);
            int order = 0;
            for (FieldBody field : body.fields() == null ? List.<FieldBody>of() : body.fields()) {
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
            audit.record(identity.principal(), identity.surface(), SCHEMA, "type.create", "content_type", type.id(),
                    AuditLog.OK, null);
        });
        return typeJson(type);
    }

    /**
     * 02 BQ-08: everything the database would reject (column lengths, the slug_policy CHECK, the unique type key and
     * field keys), plus unknown field types. All problems are returned together, in body order.
     */
    private List<FieldError> validateType(TypeBody body) {
        List<FieldError> errors = new ArrayList<>();
        if (body.key() == null || body.key().isBlank()) {
            errors.add(new FieldError("key", FieldErrorCode.REQUIRED, "key is required"));
        } else if (!body.key().matches("^[a-z][a-z0-9_]{1,62}$")) {
            errors.add(new FieldError("key", FieldErrorCode.INVALID_FORMAT, "key must match ^[a-z][a-z0-9_]{1,62}$"));
        } else if (store.findTypeByKey(body.key()).isPresent()) {
            errors.add(new FieldError("key", FieldErrorCode.DUPLICATE, "a content type with this key exists"));
        }
        maxLength(errors, "displayName", body.displayName(), 80);
        maxLength(errors, "pluralDisplayName", body.pluralDisplayName(), 80);
        maxLength(errors, "titleField", body.titleField(), 63);
        if (body.slugPolicy() != null && !List.of("required", "optional", "none").contains(body.slugPolicy())) {
            errors.add(new FieldError("slugPolicy", FieldErrorCode.NOT_IN_ENUM, "slugPolicy must be required, optional or none"));
        }
        List<FieldBody> fields = body.fields() == null ? List.of() : body.fields();
        Set<String> keys = new HashSet<>();
        for (int i = 0; i < fields.size(); i++) {
            FieldBody field = fields.get(i);
            String path = "fields[" + i + "]";
            if (field == null) {
                errors.add(new FieldError(path, FieldErrorCode.REQUIRED, path + " must be an object"));
                continue;
            }
            if (field.key() == null || field.key().isBlank()) {
                errors.add(new FieldError(path + ".key", FieldErrorCode.REQUIRED, path + ".key is required"));
            } else if (field.key().codePointCount(0, field.key().length()) > 63) {
                errors.add(new FieldError(path + ".key", FieldErrorCode.TOO_LONG, path + ".key is longer than 63"));
            } else if (!keys.add(field.key())) {
                errors.add(new FieldError(path + ".key", FieldErrorCode.DUPLICATE, path + ".key repeats an earlier field"));
            }
            if (field.type() != null && !FIELD_TYPES.contains(field.type())) {
                errors.add(new FieldError(path + ".type", FieldErrorCode.NOT_IN_ENUM, path + ".type is not a field type"));
            }
            maxLength(errors, path + ".refTarget", field.refTarget(), 63);
        }
        return errors;
    }

    private static void maxLength(List<FieldError> errors, String path, String value, int max) {
        if (value != null && value.codePointCount(0, value.length()) > max) {
            errors.add(new FieldError(path, FieldErrorCode.TOO_LONG, path + " is longer than " + max));
        }
    }

    @PostMapping("/content-types/{typeKey}/disable")
    public Map<String, Object> disable(@PathVariable String typeKey, HttpServletRequest request) {
        return setEnabled(typeKey, false, request);
    }

    @PostMapping("/content-types/{typeKey}/enable")
    public Map<String, Object> enable(@PathVariable String typeKey, HttpServletRequest request) {
        return setEnabled(typeKey, true, request);
    }

    private Map<String, Object> setEnabled(String typeKey, boolean enabled, HttpServletRequest request) {
        IdentityRequest identity = manageTypes(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        ContentTypeRecord updated = type.withEnabled(enabled, Instant.now());
        transactions.run(() -> {
            store.updateType(updated);
            audit.record(identity.principal(), identity.surface(), SCHEMA, enabled ? "type.enable" : "type.disable",
                    "content_type", type.id(), AuditLog.OK, null);
        });
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

    private IdentityRequest manageTypes(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        authorization.require(identity.principal(), CmsAction.MANAGE_TYPES, null, null, identity.surface());
        return identity;
    }

    private static IdentityRequest adminSurface(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        if (identity.surface() != Surface.ADMIN) {
            throw IdentityException.surfaceForbidden("delete", null, identity.surface().wire());
        }
        return identity;
    }

    private Map<String, Object> typeJson(ContentTypeRecord type) {
        return ContentProjection.typeSchema(type, store.fieldsOf(type.id()), true);
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
