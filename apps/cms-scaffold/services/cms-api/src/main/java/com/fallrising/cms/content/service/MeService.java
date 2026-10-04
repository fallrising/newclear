package com.fallrising.cms.content.service;

import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.ListQueryParser;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Member endpoints (02 §4.5, BD-12): entries of a type with an ownerField whose owner is the caller. Front surface
 * only. Reads are gated by ownership, not by read_draft (members never get read_draft on Front); create needs the
 * create action and the server sets the ownerField.
 */
@Service
public class MeService {

    /** Result of a member list: the type, its fields and one page. */
    public record MeList(ContentTypeRecord type, List<FieldRecord> fields, EntryPage page, int pageNo, int size) {}

    /** One entry with its type and fields for projection. */
    public record MeEntry(ContentTypeRecord type, List<FieldRecord> fields, EntryRecord entry) {}

    private final ContentStore store;
    private final EntryService entries;
    private final AuthorizationService authorization;
    private final MeRateLimiter rateLimiter;

    public MeService(ContentStore store, EntryService entries, AuthorizationService authorization, MeRateLimiter rateLimiter) {
        this.store = store;
        this.entries = entries;
        this.authorization = authorization;
        this.rateLimiter = rateLimiter;
    }

    /**
     * The caller's entries of typeKey in draft or published state. page, size and sort follow the work list grammar
     * (waves/BW1b.md §4.3); state and publishRequested are validated but never widen the fixed states or narrow open requests.
     */
    public MeList list(Principal principal, Surface surface, String typeKey, Map<String, String[]> params) {
        requireMember(principal, surface);
        ContentTypeRecord type = ownedType(typeKey);
        List<FieldRecord> fields = store.fieldsOf(type.id());
        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.WORK, params);
        AccessFilter mine = AccessFilter.anyOf(List.of(new AccessFilter.Clause(type.ownerField(), principal.id().toString())));
        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, List.of("draft", "published"),
                type.titleField(), parsed.q(), parsed.filters(), parsed.refs(), mine, null, List.of(), parsed.sort(),
                parsed.page(), parsed.size(), false));
        return new MeList(type, fields, page, parsed.page(), parsed.size());
    }

    /** One of the caller's entries; another member's entry is 403 FORBIDDEN (surface-front AC-11), not 404. */
    public MeEntry get(Principal principal, Surface surface, UUID id) {
        requireMember(principal, surface);
        EntryRecord entry = store.findEntry(id).orElseThrow(ContentException::notFound);
        if (entry.deleted()) {
            throw ContentException.notFound();
        }
        ContentTypeRecord type = store.findTypeByKey(entry.contentTypeKey()).orElseThrow(ContentException::notFound);
        if (type.ownerField() == null || !type.enabled()) {
            throw ContentException.notFound();
        }
        Object owner = entry.payload() == null ? null : entry.payload().get(type.ownerField());
        if (!principal.id().toString().equals(owner)) {
            throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), type.typeKey(), surface.wire());
        }
        return new MeEntry(type, store.fieldsOf(type.id()), entry);
    }

    /**
     * Creates a draft owned by the caller. Steps: Front and signed in; type has an ownerField; caller has create on
     * the type on Front (403 otherwise); rate limit (429); ownerField set to the caller (any client value replaced);
     * required fields must not be empty (422 REQUIRED; members cannot publish, so the publish-time check is done here);
     * every ref field whose target type has an ownerField must point to an entry the caller owns (422
     * REF_TARGET_NOT_FOUND otherwise, so other members' ids are not confirmed); then EntryService.create.
     */
    public MeEntry create(Principal principal, Surface surface, String typeKey, Map<String, Object> payload) {
        return create(principal, surface, typeKey, payload, false);
    }

    /** HTTP metadata is rejected after access checks and before consuming quota. */
    public MeEntry create(Principal principal, Surface surface, String typeKey, Map<String, Object> payload, boolean statePresent) {
        requireMember(principal, surface);
        ContentTypeRecord type = ownedType(typeKey);
        if (!authorization.hasAction(principal, CmsAction.CREATE, typeKey, surface)) {
            throw IdentityException.forbidden(CmsAction.CREATE.wire(), typeKey, surface.wire());
        }
        if (statePresent) throw ContentException.invalidParameter("publicationState is not accepted");
        rateLimiter.acquire(principal.id());
        Map<String, Object> body = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
        body.put(type.ownerField(), principal.id().toString());
        List<FieldRecord> fields = store.fieldsOf(type.id());
        List<FieldError> errors = new ArrayList<>();
        for (FieldRecord field : fields) {
            if (!field.enabled()) continue;
            Object value = body.get(field.fieldKey());
            if (field.required() && (value == null || (value instanceof String text && text.isBlank()))) {
                errors.add(new FieldError("payload." + field.fieldKey(), FieldErrorCode.REQUIRED,
                        "Missing required field " + field.fieldKey()));
            }
        }
        errors.addAll(foreignRefs(principal, fields, body));
        if (!errors.isEmpty()) {
            throw ContentException.fieldErrors(errors);
        }
        EntryRecord created = entries.create(principal, surface, typeKey, null, body);
        return new MeEntry(type, fields, created);
    }

    private List<FieldError> foreignRefs(Principal principal, List<FieldRecord> fields, Map<String, Object> body) {
        List<FieldError> errors = new ArrayList<>();
        for (FieldRecord field : fields) {
            if (!field.enabled() || !"ref".equals(field.fieldType()) || field.refTargetTypeKey() == null) continue;
            ContentTypeRecord target = store.findTypeByKey(field.refTargetTypeKey()).orElse(null);
            Object raw = body.get(field.fieldKey());
            if (target == null || target.ownerField() == null || !(raw instanceof String text)) continue;
            EntryRecord entry = uuid(text) == null ? null : store.findEntry(uuid(text)).orElse(null);
            if (entry == null) continue;
            Object owner = entry.payload() == null ? null : entry.payload().get(target.ownerField());
            if (!principal.id().toString().equals(owner)) {
                errors.add(new FieldError("payload." + field.fieldKey(), FieldErrorCode.REF_TARGET_NOT_FOUND,
                        "Referenced entry not found"));
            }
        }
        return errors;
    }

    private ContentTypeRecord ownedType(String typeKey) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        if (!type.enabled() || type.ownerField() == null) {
            throw ContentException.typeNotFound();
        }
        return type;
    }

    private static void requireMember(Principal principal, Surface surface) {
        if (principal == null) {
            throw IdentityException.unauthenticated();
        }
        if (surface != Surface.FRONT) {
            throw IdentityException.surfaceForbidden("me", null, surface == null ? null : surface.wire());
        }
    }

    private static UUID uuid(String text) {
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equals(text) ? id : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
