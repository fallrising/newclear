package com.fallrising.cms.content.store;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.FieldFilter;
import com.fallrising.cms.content.query.RefFilter;
import com.fallrising.cms.content.query.SortKey;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
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
    private final ConcurrentHashMap<UUID, List<IndexRow>> index = new ConcurrentHashMap<>();

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
                type.updatedAt(),
                current.sortField(),
                current.visibilityField(),
                current.ownerField()));
    }

    @Override
    public synchronized void updateTypeSettings(ContentTypeRecord type) {
        types.computeIfPresent(type.typeKey(), (key, current) -> current.id().equals(type.id())
                ? current.withSettings(type.sortField(), type.visibilityField(), type.ownerField(), type.updatedAt())
                : current);
        reindexType(type.id());
    }

    @Override
    public List<FieldRecord> fieldsOf(UUID typeId) {
        return fields.getOrDefault(typeId, List.of()).stream()
                .sorted(Comparator.comparingInt(FieldRecord::sortOrder).thenComparing(FieldRecord::fieldKey))
                .toList();
    }

    @Override
    public synchronized void insertField(FieldRecord field) {
        fields.computeIfAbsent(field.contentTypeId(), ignored -> new CopyOnWriteArrayList<>()).add(field);
        reindexType(field.contentTypeId());
    }

    @Override
    public void updateFieldMetadata(FieldRecord field) {
        List<FieldRecord> list = fields.get(field.contentTypeId());
        if (list == null) {
            return;
        }
        list.replaceAll(current -> current.id().equals(field.id())
                ? current.withMetadata(field.label(), field.groupKey(), field.listable(), field.filterable(),
                        field.enumLabels(), field.placeholder(), field.helpText())
                : current);
    }

    @Override
    public void markMediaRefsPublic() {
        fields.replaceAll((typeId, list) -> {
            List<FieldRecord> next = new CopyOnWriteArrayList<>();
            for (FieldRecord field : list) {
                if ("media-ref".equals(field.fieldType()) && !field.publicBytes()) {
                    next.add(field.withPublicBytes(true));
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
    public synchronized EntryPage queryEntries(EntryQuery query) {
        List<EntryRecord> matching = entries.values().stream()
                .filter(e -> matches(e, query))
                .sorted(order(query))
                .toList();
        List<EntryRecord> page = matching.stream().skip(query.offset()).limit(query.size()).toList();
        return new EntryPage(page, matching.size());
    }

    @Override
    public synchronized List<IndexRow> indexRowsOf(UUID entryId) {
        return index.getOrDefault(entryId, List.of()).stream()
                .sorted(Comparator.comparing((IndexRow r) -> r.scope().wire()).thenComparing(IndexRow::fieldKey))
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
    public synchronized EntryRecord insertEntry(EntryRecord entry) {
        List<IndexRow> rows = rowsFor(entry);
        entries.put(entry.id(), entry);
        index.put(entry.id(), rows);
        return entry;
    }

    @Override
    public synchronized EntryRecord updateEntry(EntryRecord entry) {
        List<IndexRow> rows = rowsFor(entry);
        entries.compute(entry.id(), (id, current) -> {
            if (current == null || current.version() != entry.version() - 1) {
                throw ContentException.versionConflict();
            }
            return entry;
        });
        index.put(entry.id(), rows);
        return entry;
    }

    @Override
    public synchronized void hardDeleteEntry(UUID id, int expectedVersion) {
        entries.compute(id, (key, current) -> {
            if (current == null || current.version() != expectedVersion) {
                throw ContentException.versionConflict();
            }
            return null;
        });
        revisions.remove(id);
        refs.remove(id);
        index.remove(id);
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

    // ---- index maintenance ----

    private void reindex(EntryRecord entry) {
        index.put(entry.id(), rowsFor(entry));
    }

    private List<IndexRow> rowsFor(EntryRecord entry) {
        ContentTypeRecord type = typeById(entry.contentTypeId());
        return type == null ? List.of() : EntryIndexer.rows(type, fieldsOf(type.id()), entry);
    }

    private void reindexType(UUID typeId) {
        entries.values().stream().filter(e -> e.contentTypeId().equals(typeId)).forEach(this::reindex);
    }

    private ContentTypeRecord typeById(UUID typeId) {
        return types.values().stream().filter(t -> t.id().equals(typeId)).findFirst().orElse(null);
    }


    // ---- query evaluation; must match JdbcContentStore.queryEntries ----

    private boolean matches(EntryRecord e, EntryQuery query) {
        if (!e.contentTypeId().equals(query.typeId()) || e.deleted()) return false;
        IndexScope scope = query.scope();
        if (scope == IndexScope.WORK) {
            if (!query.states().contains(e.publicationState().wire())) return false;
        } else {
            if (e.publicationState() != PublicationState.PUBLISHED || e.publishedPayload() == null) return false;
            if (query.visibilityField() != null) {
                Object visibility = e.publishedPayload().get(query.visibilityField());
                if (visibility != null && !String.valueOf(visibility).isBlank()
                        && !"public".equals(String.valueOf(visibility))) return false;
            }
            for (String refField : query.requiredRefs()) {
                Object ref = e.publishedPayload().get(refField);
                if (ref != null && !publiclyReadable(String.valueOf(ref))) return false;
            }
        }
        if (query.q() != null && !query.q().isBlank()) {
            IndexRow title = query.titleField() == null ? null : row(e.id(), scope, query.titleField());
            if (title == null || title.stringValue() == null
                    || !title.stringValue().toLowerCase(Locale.ROOT).contains(query.q().toLowerCase(Locale.ROOT))) {
                return false;
            }
        }
        for (FieldFilter filter : query.filters()) {
            if (!matches(row(e.id(), scope, filter.fieldKey()), filter)) return false;
        }
        for (RefFilter ref : query.refs()) {
            boolean found = refs.getOrDefault(e.id(), List.of()).stream()
                    .anyMatch(r -> ref.fieldKey().equals(r.fieldKey()) && ref.targetId().equals(r.toId()));
            if (!found) return false;
        }
        AccessFilter access = query.access();
        if (!access.unrestricted()) {
            boolean allowed = access.anyOf().stream().anyMatch(clause -> {
                IndexRow row = row(e.id(), scope, clause.fieldKey());
                return row != null && clause.value().equals(row.stringValue());
            });
            if (!allowed) return false;
        }
        return true;
    }

    private static boolean matches(IndexRow row, FieldFilter filter) {
        if (row == null) return false;
        if (filter.op() == FieldFilter.Op.RANGE) {
            Instant ts = row.tsValue();
            if (ts == null) return false;
            return (filter.from() == null || !ts.isBefore(filter.from())) && (filter.to() == null || ts.isBefore(filter.to()));
        }
        return switch (filter.kind()) {
            case "int" -> row.intValue() != null && filter.value() instanceof Number number
                    && row.intValue().compareTo(new java.math.BigDecimal(number.toString())) == 0;
            case "bool" -> Objects.equals(row.boolValue(), filter.value());
            default -> Objects.equals(row.stringValue(), filter.value());
        };
    }

    /** Target id text of a required ref: the entry exists, is not deleted, is published and is not private. */
    private boolean publiclyReadable(String targetText) {
        UUID targetId;
        try {
            targetId = UUID.fromString(targetText);
        } catch (IllegalArgumentException e) {
            return false;
        }
        if (!targetId.toString().equals(targetText)) return false;
        EntryRecord target = entries.get(targetId);
        if (target == null || target.deleted() || target.publicationState() != PublicationState.PUBLISHED
                || target.publishedPayload() == null) {
            return false;
        }
        ContentTypeRecord targetType = typeById(target.contentTypeId());
        if (targetType == null || targetType.visibilityField() == null) return true;
        Object visibility = target.publishedPayload().get(targetType.visibilityField());
        return visibility == null || !"private".equals(String.valueOf(visibility));
    }

    private IndexRow row(UUID entryId, IndexScope scope, String fieldKey) {
        return index.getOrDefault(entryId, List.of()).stream()
                .filter(r -> r.scope() == scope && r.fieldKey().equals(fieldKey))
                .findFirst()
                .orElse(null);
    }

    private Comparator<EntryRecord> order(EntryQuery query) {
        SortKey sort = query.sort();
        Comparator<EntryRecord> primary = (a, b) -> {
            Comparable<Object> va = sortValue(a, sort, query.scope());
            Comparable<Object> vb = sortValue(b, sort, query.scope());
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            int result = va.compareTo(vb);
            return sort.descending() ? -result : result;
        };
        return primary
                .thenComparing(EntryRecord::updatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(e -> e.id().toString());
    }

    @SuppressWarnings("unchecked")
    private Comparable<Object> sortValue(EntryRecord e, SortKey sort, IndexScope scope) {
        if (sort.source() == SortKey.Source.SYSTEM) {
            return (Comparable<Object>) (Comparable<?>) switch (sort.key()) {
                case "createdAt" -> e.createdAt();
                case "publishedAt" -> e.publishedAt();
                default -> e.updatedAt();
            };
        }
        IndexRow row = row(e.id(), scope, sort.key());
        if (row == null) return null;
        return (Comparable<Object>) (Comparable<?>) switch (sort.kind()) {
            case "int" -> row.intValue();
            case "bool" -> row.boolValue();
            case "datetime" -> row.tsValue();
            default -> row.stringValue();
        };
    }


}
