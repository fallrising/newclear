package com.fallrising.cms.content.store;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.RevisionRecord;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class InMemoryContentStore implements ContentStore {

    private final ConcurrentHashMap<String, ContentTypeRecord> types = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<FieldRecord>> fields = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, EntryRecord> entries = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<RevisionRecord>> revisions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<EntryRefRecord>> refs = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, NavigationRecord> menus = new ConcurrentHashMap<>();

    @Override
    public Optional<ContentTypeRecord> findTypeByKey(String typeKey) {
        return Optional.ofNullable(types.get(typeKey));
    }

    @Override
    public List<ContentTypeRecord> listTypes() {
        return types.values().stream().sorted(Comparator.comparing(ContentTypeRecord::typeKey)).toList();
    }

    @Override
    public void insertType(ContentTypeRecord type) {
        if (types.putIfAbsent(type.typeKey(), type) != null) {
            throw new IllegalStateException("type key taken: " + type.typeKey());
        }
    }

    @Override
    public void updateType(ContentTypeRecord type) {
        types.computeIfPresent(type.typeKey(), (key, current) -> new ContentTypeRecord(
                current.id(),
                current.typeKey(),
                type.displayName(),
                type.pluralDisplayName(),
                type.description(),
                current.titleField(),
                current.slugPolicy(),
                current.singleton(),
                type.enabled(),
                current.previewable(),
                current.publicRequiresPublishedRefs(),
                current.createdAt(),
                type.updatedAt()));
    }

    @Override
    public List<FieldRecord> fieldsOf(UUID typeId) {
        return fields.getOrDefault(typeId, List.of()).stream()
                .sorted(Comparator.comparingInt(FieldRecord::sortOrder).thenComparing(FieldRecord::fieldKey))
                .toList();
    }

    @Override
    public void insertField(FieldRecord field) {
        fields.computeIfAbsent(field.contentTypeId(), ignored -> new CopyOnWriteArrayList<>()).add(field);
    }

    @Override
    public void markMediaRefsPublic() {
        fields.replaceAll((typeId, list) -> {
            List<FieldRecord> next = new CopyOnWriteArrayList<>();
            for (FieldRecord field : list) {
                if ("media-ref".equals(field.fieldType()) && !field.publicBytes()) {
                    next.add(new FieldRecord(
                            field.id(),
                            field.contentTypeId(),
                            field.fieldKey(),
                            field.fieldType(),
                            field.required(),
                            field.uniqueInType(),
                            field.indexed(),
                            field.visibility(),
                            field.sortOrder(),
                            field.refTargetTypeKey(),
                            field.onDelete(),
                            field.enumValues(),
                            field.enabled(),
                            true));
                } else {
                    next.add(field);
                }
            }
            return next;
        });
    }

    @Override
    public Optional<EntryRecord> findEntry(UUID id) {
        return Optional.ofNullable(entries.get(id));
    }

    @Override
    public Optional<EntryRecord> findBySlug(UUID typeId, String slug) {
        if (slug == null) {
            return Optional.empty();
        }
        return entries.values().stream()
                .filter(e -> e.contentTypeId().equals(typeId) && slug.equals(e.slug()))
                .findFirst();
    }

    @Override
    public List<EntryRecord> listEntries(
            UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget) {
        return entries.values().stream()
                .filter(e -> e.contentTypeId().equals(typeId))
                .filter(e -> includeDeleted || !e.deleted())
                .filter(e -> states == null || states.isEmpty() || states.contains(e.publicationState().wire()))
                .filter(e -> matchesQ(e, q))
                .filter(e -> matchesRef(e.id(), refField, refTarget))
                .sorted(Comparator.comparing(EntryRecord::updatedAt).reversed())
                .toList();
    }

    @Override
    public long countEntries(UUID typeId, boolean includeDeleted) {
        return entries.values().stream()
                .filter(e -> e.contentTypeId().equals(typeId))
                .filter(e -> includeDeleted || !e.deleted())
                .count();
    }

    @Override
    public EntryRecord insertEntry(EntryRecord entry) {
        entries.put(entry.id(), entry);
        return entry;
    }

    @Override
    public EntryRecord updateEntry(EntryRecord entry) {
        entries.put(entry.id(), entry);
        return entry;
    }

    @Override
    public void hardDeleteEntry(UUID id) {
        entries.remove(id);
        revisions.remove(id);
        refs.remove(id);
    }

    @Override
    public void insertRevision(RevisionRecord revision) {
        revisions.computeIfAbsent(revision.entryId(), ignored -> new CopyOnWriteArrayList<>()).add(revision);
    }

    @Override
    public List<RevisionRecord> revisionsOf(UUID entryId) {
        return revisions.getOrDefault(entryId, List.of()).stream()
                .sorted(Comparator.comparingInt(RevisionRecord::revisionNo).reversed())
                .toList();
    }

    @Override
    public void deleteOldestRevisions(UUID entryId, int keep) {
        List<RevisionRecord> all = new ArrayList<>(revisionsOf(entryId));
        if (all.size() <= keep) {
            return;
        }
        all.sort(Comparator.comparingInt(RevisionRecord::revisionNo).reversed());
        revisions.put(entryId, new CopyOnWriteArrayList<>(all.subList(0, keep)));
    }

    @Override
    public void replaceRefs(UUID entryId, List<EntryRefRecord> next) {
        refs.put(entryId, new ArrayList<>(next));
    }

    @Override
    public List<EntryRefRecord> refsTo(UUID toId) {
        return refs.values().stream().flatMap(List::stream).filter(r -> r.toId().equals(toId)).toList();
    }

    @Override
    public Optional<NavigationRecord> findNavigation(String menuKey) {
        return Optional.ofNullable(menus.get(menuKey));
    }

    @Override
    public void upsertNavigation(NavigationRecord menu) {
        menus.put(menu.menuKey(), menu);
    }

    private boolean matchesQ(EntryRecord entry, String q) {
        if (q == null || q.isBlank()) {
            return true;
        }
        Object title = entry.payload() == null ? null : entry.payload().get("title");
        return title != null && title.toString().toLowerCase(Locale.ROOT).contains(q.toLowerCase(Locale.ROOT));
    }

    private boolean matchesRef(UUID fromId, String field, UUID target) {
        if (field == null || target == null) {
            return true;
        }
        return refs.getOrDefault(fromId, List.of()).stream()
                .anyMatch(r -> field.equals(r.fieldKey()) && target.equals(r.toId()));
    }
}
