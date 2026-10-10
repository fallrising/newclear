package com.fallrising.cms.content.service;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.content.validation.PayloadValidator;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.PublicVisibility;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.ListQueryParser;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.service.AuditLog;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.service.MediaService;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class EntryService {

    private static final int REVISION_KEEP = 20;

    private final ContentStore store;
    private final AuthorizationService authorization;
    private final IdentityStore identityStore;
    private final MediaService mediaService;
    private final PayloadValidator payloadValidator;
    private final AuditLog audit;

    public EntryService(ContentStore store, AuthorizationService authorization, IdentityStore identityStore, MediaService mediaService) {
        this(store, authorization, identityStore, mediaService, new AuditLog(identityStore, new ObjectMapper()));
    }

    @Autowired
    public EntryService(
            ContentStore store,
            AuthorizationService authorization,
            IdentityStore identityStore,
            MediaService mediaService,
            AuditLog audit) {
        this.store = store;
        this.authorization = authorization;
        this.identityStore = identityStore;
        this.mediaService = mediaService;
        this.payloadValidator = new PayloadValidator(store, identityStore);
        this.audit = audit;
    }

    public ContentTypeRecord requireType(String typeKey) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        if (!type.enabled()) {
            throw ContentException.typeDisabled();
        }
        return type;
    }

    public EntryRecord create(Principal principal, Surface surface, String typeKey, String slug, Map<String, Object> payload) {
        return store.writeTransaction(() -> {
            ContentTypeRecord type = requireType(typeKey);
            authorization.require(principal, CmsAction.CREATE, typeKey, payload, surface);
            if (type.singleton() && store.countEntries(type.id(), true) > 0) {
                throw ContentException.singletonExists();
            }
            ensureSlugFree(type.id(), slug, null);
            Instant now = Instant.now();
            UUID actor = principal == null ? null : principal.id();
            Map<String, Object> body = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
            validatePayload(type, body, false);
            EntryRecord entry = new EntryRecord(
                    UUID.randomUUID(),
                    type.id(),
                    type.typeKey(),
                    slug,
                    PublicationState.DRAFT,
                    1,
                    body,
                    null,
                    null,
                    null,
                    null,
                    actor,
                    actor,
                    now,
                    now);
            store.insertEntry(entry);
            store.replaceRefs(entry.id(), extractRefs(entry, type));
            mediaService.replaceAttachments(entry.id(), extractMediaAttachments(entry, type));
            record(principal, surface, "entry.create", entry, null);
            return entry;
        });
    }

    public EntryRecord getWork(Principal principal, Surface surface, UUID id) {
        EntryRecord entry = store.findEntry(id).orElseThrow(ContentException::notFound);
        if (entry.deleted()) {
            throw ContentException.notFound();
        }
        CmsAction action = entry.publicationState() == PublicationState.PUBLISHED
                ? CmsAction.READ_PUBLISHED
                : CmsAction.READ_DRAFT;
        if (entry.publicationState() == PublicationState.PUBLISHED) {
            try {
                authorization.require(principal, CmsAction.READ_DRAFT, entry.contentTypeKey(), entry.payload(), surface);
            } catch (IdentityException ignored) {
                authorization.require(principal, CmsAction.READ_PUBLISHED, entry.contentTypeKey(), entry.payload(), surface);
            }
        } else {
            authorization.require(principal, action, entry.contentTypeKey(), entry.payload(), surface);
        }
        return entry;
    }

    /** One list page with the type and fields used to build it, so callers project items without further store reads. */
    public record ListResult(ContentTypeRecord type, List<FieldRecord> fields, EntryPage page, int pageNo, int size) {}

    /**
     * Work list (02 §4.1). Needs read_draft when the states include draft or archived, otherwise read_published;
     * predicate grants become an AccessFilter evaluated by the store (B-10).
     */
    public ListResult listWork(Principal principal, Surface surface, String typeKey, Map<String, String[]> params) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::typeNotFound);
        List<FieldRecord> fields = store.fieldsOf(type.id());
        AccessFilter access = accessFilter(authorization.listAccess(
                principal, workListAction(params), typeKey, surface));
        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.WORK, params);
        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.WORK, parsed.states(), type.titleField(),
                parsed.q(), parsed.filters(), parsed.refs(), access, null, List.of(), parsed.sort(), parsed.page(), parsed.size(), parsed.publishRequested()));
        return new ListResult(type, fields, page, parsed.page(), parsed.size());
    }

    /** Determine the action before validating other parameters, so denied callers always receive 403. */
    private static CmsAction workListAction(Map<String, String[]> params) {
        String[] values = params.get("state");
        if (values == null) return CmsAction.READ_DRAFT;
        boolean published = false;
        for (String raw : values) {
            if (raw == null) continue;
            for (String state : raw.split(",")) {
                if (state.isBlank()) continue;
                if (!"published".equals(state.trim())) return CmsAction.READ_DRAFT;
                published = true;
            }
        }
        return published ? CmsAction.READ_PUBLISHED : CmsAction.READ_DRAFT;
    }

    public EntryRecord patch(Principal principal, Surface surface, UUID id, String slug, Map<String, Object> payload, Integer version) {
        return store.writeTransaction(() -> {
            PreparedPatch prepared = preparePatch(principal, surface, id, slug, payload, version);
            if (!prepared.errors().isEmpty()) throw ContentException.fieldErrors(prepared.errors());
            return applyPatch(prepared);
        });
    }

    public record BatchItem(UUID id, Integer version, Map<String, Object> payload) {}
    public static final int BATCH_MAX = 100;

    /** Validate the entire batch before writing; CAS and all dependents share the same transaction. */
    public List<EntryRecord> batchPatch(Principal principal, Surface surface, List<BatchItem> items) {
        if (items == null || items.isEmpty() || items.size() > BATCH_MAX) {
            throw ContentException.invalidParameter("items must contain 1 to " + BATCH_MAX + " entries");
        }
        Set<UUID> seen = new HashSet<>();
        for (int i = 0; i < items.size(); i++) {
            BatchItem item = items.get(i);
            if (item == null || item.id() == null) throw ContentException.invalidParameter("items[" + i + "].id is required");
            if (!seen.add(item.id())) throw ContentException.invalidParameter("items[" + i + "].id is repeated");
        }
        return store.writeTransaction(() -> {
            List<PreparedPatch> prepared = new ArrayList<>();
            List<FieldError> errors = new ArrayList<>();
            for (int i = 0; i < items.size(); i++) {
                BatchItem item = items.get(i);
                PreparedPatch one;
                try {
                    one = preparePatch(principal, surface, item.id(), null, item.payload(), item.version());
                } catch (CmsApiException failure) {
                    throw ContentException.inBatchItem(i, failure);
                }
                String prefix = "items[" + i + "].";
                one.errors().forEach(error -> errors.add(new FieldError(prefix + error.field(), error.code(), error.message())));
                prepared.add(one);
            }
            if (!errors.isEmpty()) throw ContentException.fieldErrors(errors);
            List<EntryRecord> updated = new ArrayList<>();
            for (int i = 0; i < prepared.size(); i++) {
                try {
                    updated.add(applyPatch(prepared.get(i)));
                } catch (CmsApiException failure) {
                    throw ContentException.inBatchItem(i, failure);
                } catch (RuntimeException failure) {
                    ContentException wrapped = ContentException.validation(ErrorCode.INTERNAL_ERROR, "items[" + i + "]: Batch write failed");
                    wrapped.initCause(failure);
                    throw wrapped;
                }
            }
            return updated;
        });
    }

    private record PreparedPatch(EntryRecord updated, ContentTypeRecord type, List<FieldError> errors) {}

    private PreparedPatch preparePatch(Principal principal, Surface surface, UUID id, String slug,
            Map<String, Object> payload, Integer version) {
        EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
        if (current.deleted() || current.publicationState() == PublicationState.ARCHIVED) throw ContentException.invalidTransition();
        authorization.require(principal, CmsAction.UPDATE, current.contentTypeKey(), current.payload(), surface);
        if (version == null) throw ContentException.versionRequired();
        if (version != current.version()) throw ContentException.versionConflict();
        ContentTypeRecord type = store.findTypeByKey(current.contentTypeKey()).orElseThrow(ContentException::typeNotFound);
        String nextSlug = slug != null ? slug : current.slug();
        ensureSlugFree(type.id(), nextSlug, current.id());
        Map<String, Object> nextPayload = current.payloadCopy();
        if (payload != null) nextPayload.putAll(payload);
        List<FieldError> errors = payloadValidator.validate(store.fieldsOf(type.id()), nextPayload, false);
        EntryRecord updated = new EntryRecord(current.id(), current.contentTypeId(), current.contentTypeKey(), nextSlug,
                current.publicationState(), current.version() + 1, nextPayload, current.publishedPayload(), current.publishedAt(),
                current.archivedAt(), current.deletedAt(), current.createdBy(), principal == null ? current.updatedBy() : principal.id(),
                current.createdAt(), Instant.now(), current.publishRequestedAt(), current.publishRequestedBy());
        return new PreparedPatch(updated, type, errors);
    }

    private EntryRecord applyPatch(PreparedPatch prepared) {
        EntryRecord updated = prepared.updated();
        store.updateEntry(updated);
        store.replaceRefs(updated.id(), extractRefs(updated, prepared.type()));
        mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, prepared.type()));
        return updated;
    }

    public EntryRecord requestPublish(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.UPDATE);
            if (current.publicationState() != PublicationState.DRAFT
                    && !(current.publicationState() == PublicationState.PUBLISHED && current.dirty())) {
                throw ContentException.invalidTransition();
            }
            if (current.publishRequestedAt() != null) return current;
            return changePublishRequest(principal, surface, current, Instant.now().truncatedTo(ChronoUnit.MICROS), principal == null ? null : principal.id(),
                    "entry.publish_request");
        });
    }

    public EntryRecord cancelPublishRequest(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.UPDATE);
            if (current.publishRequestedAt() == null) return current;
            return changePublishRequest(principal, surface, current, null, null, "entry.publish_request_cancel");
        });
    }

    private EntryRecord changePublishRequest(Principal principal, Surface surface, EntryRecord current, Instant at, UUID by, String action) {
        EntryRecord next = new EntryRecord(current.id(), current.contentTypeId(), current.contentTypeKey(), current.slug(),
                current.publicationState(), current.version() + 1, current.payloadCopy(), current.publishedPayload(), current.publishedAt(),
                current.archivedAt(), current.deletedAt(), current.createdBy(), principal == null ? current.updatedBy() : principal.id(),
                current.createdAt(), Instant.now().truncatedTo(ChronoUnit.MICROS), at, by);
        store.updateEntry(next);
        record(principal, surface, action, next, null);
        return next;
    }

    public EntryRecord publish(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
            if (current.deleted()) {
                throw ContentException.notFound();
            }
            authorization.require(principal, CmsAction.PUBLISH, current.contentTypeKey(), current.payload(), surface);
            if (current.publicationState() == PublicationState.ARCHIVED) {
                throw ContentException.invalidTransition();
            }
            ContentTypeRecord type = store.findTypeByKey(current.contentTypeKey()).orElseThrow(ContentException::typeNotFound);
            if (!type.enabled()) {
                throw ContentException.typeDisabled();
            }
            if (current.publicationState() == PublicationState.PUBLISHED && !current.dirty()) {
                if (current.publishRequestedAt() != null) {
                    return changePublishRequest(principal, surface, current, null, null, "entry.publish_request_cancel");
                }
                return current;
            }
            if ("required".equals(type.slugPolicy()) && (current.slug() == null || current.slug().isBlank())) {
                throw ContentException.validation(ErrorCode.SLUG_REQUIRED, "Slug is required to publish");
            }
            validatePayload(type, current.payload(), true);
            Instant now = Instant.now();
            int nextNo = store.revisionsOf(current.id()).stream().mapToInt(RevisionRecord::revisionNo).max().orElse(0) + 1;
            EntryRecord published = new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    PublicationState.PUBLISHED,
                    current.version() + 1,
                    current.payloadCopy(),
                    current.payloadCopy(),
                    now,
                    null,
                    current.deletedAt(),
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now);
            store.updateEntry(published);
            mediaService.replaceAttachments(published.id(), extractMediaAttachments(published, type));
            store.insertRevision(new RevisionRecord(
                    UUID.randomUUID(),
                    current.id(),
                    nextNo,
                    current.slug(),
                    current.payloadCopy(),
                    now,
                    principal == null ? null : principal.id(),
                    current.contentTypeKey()));
            store.deleteOldestRevisions(current.id(), REVISION_KEEP);
            record(principal, surface, "entry.publish", published, Map.of("revisionNo", nextNo));
            return published;
        });
    }

    public EntryRecord unpublish(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.UNPUBLISH);
            if (current.publicationState() != PublicationState.PUBLISHED) {
                throw ContentException.invalidTransition();
            }
            Instant now = Instant.now();
            EntryRecord updated = updateEntryAndAttachments(new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    PublicationState.DRAFT,
                    current.version() + 1,
                    current.payloadCopy(),
                    null,
                    null,
                    current.archivedAt(),
                    current.deletedAt(),
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now));
            record(principal, surface, "entry.unpublish", updated, null);
            return updated;
        });
    }

    public EntryRecord archive(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.ARCHIVE);
            if (current.publicationState() == PublicationState.ARCHIVED) {
                throw ContentException.invalidTransition();
            }
            Instant now = Instant.now();
            EntryRecord updated = updateEntryAndAttachments(new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    PublicationState.ARCHIVED,
                    current.version() + 1,
                    current.payloadCopy(),
                    null,
                    current.publishedAt(),
                    now,
                    current.deletedAt(),
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now));
            record(principal, surface, "entry.archive", updated, null);
            return updated;
        });
    }

    public EntryRecord restore(Principal principal, Surface surface, UUID id) {
        return store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.ARCHIVE);
            if (current.publicationState() != PublicationState.ARCHIVED) {
                throw ContentException.invalidTransition();
            }
            Instant now = Instant.now();
            EntryRecord updated = updateEntryAndAttachments(new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    PublicationState.DRAFT,
                    current.version() + 1,
                    current.payloadCopy(),
                    null,
                    current.publishedAt(),
                    null,
                    current.deletedAt(),
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now));
            record(principal, surface, "entry.restore", updated, null);
            return updated;
        });
    }

    public void softDelete(Principal principal, Surface surface, UUID id) {
        store.writeTransaction(() -> {
            EntryRecord current = loadForTransition(principal, surface, id, CmsAction.DELETE);
            if (!store.refsTo(id).isEmpty()) {
                throw ContentException.refConstraint();
            }
            Instant now = Instant.now();
            store.updateEntry(new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    current.publicationState(),
                    current.version() + 1,
                    current.payloadCopy(),
                    current.publishedPayload(),
                    current.publishedAt(),
                    current.archivedAt(),
                    now,
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now).withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy()));
            record(principal, surface, "entry.soft_delete", current, null);
            return null;
        });
    }

    public void purge(Principal principal, Surface surface, UUID id) {
        store.writeTransaction(() -> {
            if (surface != Surface.ADMIN) {
                throw IdentityException.surfaceForbidden(CmsAction.DELETE.wire(), null, surface == null ? null : surface.wire());
            }
            if (principal == null
                    || identityStore.rolesOf(principal.id()).stream()
                            .noneMatch(role -> RoleCode.ADMIN.wire().equals(role.roleCode()))) {
                throw IdentityException.forbidden(CmsAction.DELETE.wire(), null, surface.wire());
            }
            EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
            if (!store.refsTo(id).isEmpty()) {
                throw ContentException.refConstraint();
            }
            store.hardDeleteEntry(id, current.version());
            mediaService.replaceAttachments(id, List.of());
            record(principal, surface, "entry.purge", current, null);
            return null;
        });
    }

    public EntryRecord publicGet(Principal principal, String typeKey, UUID id, String slug) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
        if (!type.enabled()) {
            throw ContentException.notFound();
        }
        if (!authorization.hasAction(principal, CmsAction.READ_PUBLISHED, typeKey, Surface.FRONT)) {
            throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), typeKey, Surface.FRONT.wire());
        }
        EntryRecord entry = id != null
                ? store.findEntry(id).orElseThrow(ContentException::notFound)
                : store.findBySlug(type.id(), slug).orElseThrow(ContentException::notFound);
        if (!entry.contentTypeKey().equals(typeKey)
                || entry.deleted()
                || entry.publicationState() != PublicationState.PUBLISHED
                || entry.publishedPayload() == null
                || !PublicVisibility.gettable(type, entry.publishedPayload())) {
            throw ContentException.notFound();
        }
        if (!authorization.allow(principal, CmsAction.READ_PUBLISHED, typeKey, entry.publishedPayload(), Surface.FRONT).allowed()) {
            throw IdentityException.forbidden(CmsAction.READ_PUBLISHED.wire(), typeKey, Surface.FRONT.wire());
        }
        if (!publishedRefsPublic(entry, type)) {
            throw ContentException.notFound();
        }
        return entry;
    }

    /**
     * Public list (02 §4.1): published copies only; visibility, publicRequiresPublishedRefs and predicate grants are
     * evaluated by the store in the same query (B-02).
     */
    public ListResult publicList(Principal principal, String typeKey, Map<String, String[]> params) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
        if (!type.enabled()) {
            throw ContentException.notFound();
        }
        AccessFilter access = accessFilter(authorization.listAccess(principal, CmsAction.READ_PUBLISHED, typeKey, Surface.FRONT));
        List<FieldRecord> fields = store.fieldsOf(type.id());
        ListQueryParser.Parsed parsed = ListQueryParser.parse(type, fields, IndexScope.PUBLISHED, params);
        EntryPage page = store.queryEntries(new EntryQuery(type.id(), IndexScope.PUBLISHED, parsed.states(), type.titleField(),
                parsed.q(), parsed.filters(), parsed.refs(), access, type.visibilityField(), type.publicRequiresPublishedRefs(),
                parsed.sort(), parsed.page(), parsed.size()));
        return new ListResult(type, fields, page, parsed.page(), parsed.size());
    }

    private static AccessFilter accessFilter(AuthorizationService.ListAccess access) {
        if (access.unrestricted()) return AccessFilter.none();
        return AccessFilter.anyOf(access.anyOf().stream()
                .map(clause -> new AccessFilter.Clause(clause.field(), clause.value()))
                .toList());
    }

    private boolean publishedRefsPublic(EntryRecord entry, ContentTypeRecord type) {
        for (String refField : type.publicRequiresPublishedRefs()) {
            Object raw = entry.publishedPayload() == null ? null : entry.publishedPayload().get(refField);
            if (raw == null) {
                continue;
            }
            try {
                EntryRecord target = store.findEntry(UUID.fromString(raw.toString())).orElse(null);
                if (target == null
                        || target.deleted()
                        || target.publicationState() != PublicationState.PUBLISHED
                        || !PublicVisibility.gettable(
                                store.findTypeByKey(target.contentTypeKey()).orElse(null), target.publishedPayload())) {
                    return false;
                }
            } catch (IllegalArgumentException e) {
                return false;
            }
        }
        return true;
    }

    public List<RevisionRecord> revisions(Principal principal, Surface surface, UUID id) {
        EntryRecord entry = store.findEntry(id).orElseThrow(ContentException::notFound);
        authorization.require(principal, CmsAction.READ_DRAFT, entry.contentTypeKey(), entry.payload(), surface);
        return store.revisionsOf(id);
    }

    public EntryRecord revert(Principal principal, Surface surface, UUID id, int revisionNo) {
        return store.writeTransaction(() -> {
            EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
            authorization.require(principal, CmsAction.UPDATE, current.contentTypeKey(), current.payload(), surface);
            RevisionRecord revision = store.revisionsOf(id).stream()
                    .filter(r -> r.revisionNo() == revisionNo)
                    .findFirst()
                    .orElseThrow(ContentException::notFound);
            Instant now = Instant.now();
            EntryRecord updated = new EntryRecord(
                    current.id(),
                    current.contentTypeId(),
                    current.contentTypeKey(),
                    current.slug(),
                    current.publicationState(),
                    current.version() + 1,
                    new LinkedHashMap<>(revision.payload()),
                    current.publishedPayload(),
                    current.publishedAt(),
                    current.archivedAt(),
                    current.deletedAt(),
                    current.createdBy(),
                    principal == null ? current.updatedBy() : principal.id(),
                    current.createdAt(),
                    now).withPublishRequest(current.publishRequestedAt(), current.publishRequestedBy());
            ContentTypeRecord type = store.findTypeByKey(current.contentTypeKey()).orElseThrow(ContentException::typeNotFound);
            validatePayload(type, updated.payload(), false);
            store.updateEntry(updated);
            store.replaceRefs(updated.id(), extractRefs(updated, type));
            mediaService.replaceAttachments(updated.id(), extractMediaAttachments(updated, type));
            record(principal, surface, "entry.revert", updated, Map.of("revisionNo", revisionNo));
            return updated;
        });
    }

    /** Resolve enabled entry refs with one target read and at most one type read for the entire page. */
    public Map<UUID, Map<String, Object>> refSummaries(Principal principal, Surface surface, List<EntryRecord> entries,
            List<FieldRecord> fields) {
        List<FieldRecord> refFields = fields.stream().filter(field -> field.enabled() && "ref".equals(field.fieldType())).toList();
        Map<UUID, Map<String, UUID>> wanted = new LinkedHashMap<>();
        Set<UUID> ids = new HashSet<>();
        for (EntryRecord entry : entries) {
            Map<String, UUID> byField = new LinkedHashMap<>();
            for (FieldRecord field : refFields) {
                Object raw = entry.payload() == null ? null : entry.payload().get(field.fieldKey());
                UUID target = raw instanceof String text ? canonicalUuid(text) : null;
                if (target != null) {
                    byField.put(field.fieldKey(), target);
                    ids.add(target);
                }
            }
            wanted.put(entry.id(), byField);
        }
        Map<UUID, EntryRecord> targets = ids.isEmpty() ? Map.of() : store.findEntries(ids);
        Map<UUID, ContentTypeRecord> types = new LinkedHashMap<>();
        if (!targets.isEmpty()) store.listTypes().forEach(type -> types.put(type.id(), type));
        Map<UUID, Map<String, Object>> result = new LinkedHashMap<>();
        wanted.forEach((entryId, byField) -> {
            Map<String, Object> summaries = new LinkedHashMap<>();
            byField.forEach((key, targetId) -> {
                EntryRecord target = targets.get(targetId);
                Map<String, Object> summary = new LinkedHashMap<>();
                summary.put("id", targetId.toString());
                if (target == null || target.deleted()) {
                    summary.put("missing", true);
                } else if (!authorization.allow(principal, CmsAction.READ_DRAFT, target.contentTypeKey(), target.payload(), surface).allowed()) {
                    summary.put("restricted", true);
                } else {
                    ContentTypeRecord type = types.get(target.contentTypeId());
                    Object title = type == null || target.payload() == null ? null : target.payload().get(type.titleField());
                    summary.put("contentType", target.contentTypeKey());
                    summary.put("title", title == null ? null : String.valueOf(title));
                    summary.put("publicationState", target.publicationState().wire());
                }
                summaries.put(key, summary);
            });
            result.put(entryId, summaries);
        });
        return result;
    }

    private static UUID canonicalUuid(String text) {
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equals(text) ? id : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    private void record(Principal principal, Surface surface, String action, EntryRecord entry, Map<String, Object> detail) {
        audit.record(principal, surface, "CONTENT", action, "entry", entry.id(), AuditLog.OK, detail);
    }

    private EntryRecord loadForTransition(Principal principal, Surface surface, UUID id, CmsAction action) {
        EntryRecord current = store.findEntry(id).orElseThrow(ContentException::notFound);
        if (current.deleted()) {
            throw ContentException.notFound();
        }
        authorization.require(principal, action, current.contentTypeKey(), current.payload(), surface);
        return current;
    }

    private void ensureSlugFree(UUID typeId, String slug, UUID except) {
        if (slug == null || slug.isBlank()) {
            return;
        }
        store.findBySlug(typeId, slug).ifPresent(existing -> {
            if (except == null || !existing.id().equals(except)) {
                throw ContentException.slugConflict();
            }
        });
    }

    private void validatePayload(ContentTypeRecord type, Map<String, Object> payload, boolean publish) {
        List<FieldError> errors = payloadValidator.validate(store.fieldsOf(type.id()), payload, publish);
        if (!errors.isEmpty()) {
            throw ContentException.fieldErrors(errors);
        }
    }

    private List<EntryRefRecord> extractRefs(EntryRecord entry, ContentTypeRecord type) {
        List<EntryRefRecord> refs = new ArrayList<>();
        for (FieldRecord field : store.fieldsOf(type.id())) {
            Object value = entry.payload() == null ? null : entry.payload().get(field.fieldKey());
            if (isBlank(value)) {
                continue;
            }
            String kind = switch (field.fieldType()) {
                case "ref" -> "entry";
                case "media-ref" -> "media";
                case "principal-ref" -> "principal";
                default -> null;
            };
            if (kind == null) {
                continue;
            }
            UUID toId = "media".equals(kind) ? MediaService.parseMediaId(value) : parseUuid(value, field.fieldKey());
            if (toId != null) {
                refs.add(new EntryRefRecord(entry.id(), field.fieldKey(), toId, kind, 0));
            }
        }
        return refs;
    }

    private EntryRecord updateEntryAndAttachments(EntryRecord entry) {
        store.updateEntry(entry);
        ContentTypeRecord type = store.findTypeByKey(entry.contentTypeKey()).orElseThrow(ContentException::typeNotFound);
        mediaService.replaceAttachments(entry.id(), extractMediaAttachments(entry, type));
        return entry;
    }

    private List<MediaAttachment> extractMediaAttachments(EntryRecord entry, ContentTypeRecord type) {
        Instant now = Instant.now();
        List<MediaAttachment> attachments = new ArrayList<>();
        for (FieldRecord field : store.fieldsOf(type.id())) {
            if (!"media-ref".equals(field.fieldType())) {
                continue;
            }
            UUID workingId = MediaService.parseMediaId(entry.payload() == null ? null : entry.payload().get(field.fieldKey()));
            if (workingId != null) {
                attachments.add(new MediaAttachment(workingId, entry.id(), field.fieldKey(), now));
            }
            // Keep the published snapshot attached while draft edits or reverts change the working copy.
            UUID publishedId = entry.publicationState() == PublicationState.PUBLISHED && entry.publishedPayload() != null
                    ? MediaService.parseMediaId(entry.publishedPayload().get(field.fieldKey())) : null;
            if (publishedId != null && !publishedId.equals(workingId)) {
                attachments.add(new MediaAttachment(publishedId, entry.id(), field.fieldKey(), now));
            }
        }
        return attachments;
    }

    private static UUID parseUuid(Object value, String field) {
        try {
            return UUID.fromString(String.valueOf(value));
        } catch (IllegalArgumentException e) {
            throw ContentException.validation(ErrorCode.FIELD_VALIDATION, field + " must be a UUID");
        }
    }

    private static boolean isBlank(Object value) {
        return value == null || (value instanceof String s && s.isBlank());
    }
}
