package com.fallrising.cms.content.store;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.EntryPage;

import java.util.Collection;
import java.util.Map;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

public interface ContentStore {

    Optional<ContentTypeRecord> findTypeByKey(String typeKey);

    List<ContentTypeRecord> listTypes();

    void insertType(ContentTypeRecord type);

    void updateType(ContentTypeRecord type);

    /** Writes only type settings and updatedAt, then atomically rebuilds its entry index rows. */
    void updateTypeSettings(ContentTypeRecord type);

    List<FieldRecord> fieldsOf(UUID typeId);

    /** Inserts the field and atomically reindexes existing entries of its type. */
    void insertField(FieldRecord field);

    /** Writes only label, groupKey, listable, filterable, enumLabels, placeholder and helpText of the field with field.id(). */
    void updateFieldMetadata(FieldRecord field);

    default void markMediaRefsPublic() {}

    Optional<EntryRecord> findEntry(UUID id);

    /** Reads all matching IDs, including deleted targets, in one bounded store operation. */
    Map<UUID, EntryRecord> findEntries(Collection<UUID> ids);

    Optional<EntryRecord> findBySlug(UUID typeId, String slug);

    /** Both scopes, ordered by scope then field key. */
    List<IndexRow> indexRowsOf(UUID id);

    /** Evaluates filters and authorization before pagination; excludes deleted entries. */
    EntryPage queryEntries(EntryQuery query);

    long countEntries(UUID typeId, boolean includeDeleted);

    /** Atomically inserts the entry and both work/published index scopes. */
    EntryRecord insertEntry(EntryRecord entry);

    /** Atomically replaces an entry and both index scopes only when stored version is entry.version() - 1. */
    EntryRecord updateEntry(EntryRecord entry);

    /** Database writes across content, media, and identity stores share this transaction. */
    default <T> T writeTransaction(Supplier<T> work) {
        return work.get();
    }

    default void hardDeleteEntry(UUID id) {
        hardDeleteEntry(id, findEntry(id).orElseThrow(com.fallrising.cms.content.ContentException::notFound).version());
    }

    void hardDeleteEntry(UUID id, int expectedVersion);

    void insertRevision(RevisionRecord revision);

    List<RevisionRecord> revisionsOf(UUID entryId);

    void deleteOldestRevisions(UUID entryId, int keep);

    void replaceRefs(UUID entryId, List<EntryRefRecord> refs);

    List<EntryRefRecord> refsTo(UUID toId);

    Optional<NavigationRecord> findNavigation(String menuKey);

    void upsertNavigation(NavigationRecord menu);
}
