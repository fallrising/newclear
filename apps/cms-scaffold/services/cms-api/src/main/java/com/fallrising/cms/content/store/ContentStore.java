package com.fallrising.cms.content.store;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.RevisionRecord;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ContentStore {

    Optional<ContentTypeRecord> findTypeByKey(String typeKey);

    List<ContentTypeRecord> listTypes();

    void insertType(ContentTypeRecord type);

    void updateType(ContentTypeRecord type);

    List<FieldRecord> fieldsOf(UUID typeId);

    void insertField(FieldRecord field);

    default void markMediaRefsPublic() {}

    Optional<EntryRecord> findEntry(UUID id);

    Optional<EntryRecord> findBySlug(UUID typeId, String slug);

    List<EntryRecord> listEntries(UUID typeId, List<String> states, boolean includeDeleted, String q, String refField, UUID refTarget);

    long countEntries(UUID typeId, boolean includeDeleted);

    EntryRecord insertEntry(EntryRecord entry);

    EntryRecord updateEntry(EntryRecord entry);

    void hardDeleteEntry(UUID id);

    void insertRevision(RevisionRecord revision);

    List<RevisionRecord> revisionsOf(UUID entryId);

    void deleteOldestRevisions(UUID entryId, int keep);

    void replaceRefs(UUID entryId, List<EntryRefRecord> refs);

    List<EntryRefRecord> refsTo(UUID toId);

    Optional<NavigationRecord> findNavigation(String menuKey);

    void upsertNavigation(NavigationRecord menu);
}
