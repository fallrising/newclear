package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.store.ContentStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Behaviour every ContentStore must have (BD-10). Subclasses return an empty store from newStore().
 * InMemoryContentStoreContractTests runs it in ./gradlew test; JdbcContentStoreContractTests runs it in integrationTest.
 */
public abstract class ContentStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected ContentStore store;

    protected abstract ContentStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_typeRoundTrip() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        assertThat(store.findTypeByKey("album")).contains(album);
    }

    @Test
    void B08_unknownTypeIsEmpty() {
        assertThat(store.findTypeByKey("missing")).isEmpty();
        assertThat(store.fieldsOf(UUID.randomUUID())).isEmpty();
    }

    @Test
    void B08_listTypesOrderedByKey() {
        store.insertType(type("photo"));
        store.insertType(type("album"));
        store.insertType(type("page"));
        assertThat(store.listTypes()).extracting(ContentTypeRecord::typeKey).containsExactly("album", "page", "photo");
    }

    @Test
    void B08_updateTypeChangesOnlyMutableColumns() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        ContentTypeRecord changed = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                "name", "none", true, false, false, List.of("cover"), t(50), t(60));
        store.updateType(changed);
        ContentTypeRecord expected = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                album.titleField(), album.slugPolicy(), album.singleton(), false, album.previewable(),
                album.publicRequiresPublishedRefs(), album.createdAt(), t(60));
        assertThat(store.findTypeByKey("album")).contains(expected);
    }

    @Test
    void B08_duplicateTypeKeyIsRejected() {
        store.insertType(type("album"));
        assertThatThrownBy(() -> store.insertType(type("album"))).isInstanceOf(RuntimeException.class);
    }

    @Test
    void B08_fieldsOrderedBySortOrderThenKey() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        store.insertField(field(album.id(), "zeta", "string", 1));
        store.insertField(field(album.id(), "beta", "string", 1));
        store.insertField(field(album.id(), "alpha", "string", 2));
        store.insertField(field(album.id(), "omega", "string", 0));
        assertThat(store.fieldsOf(album.id())).extracting(FieldRecord::fieldKey)
                .containsExactly("omega", "beta", "zeta", "alpha");
    }

    @Test
    void B08_markMediaRefsPublicOnlyTouchesMediaRefFields() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        store.insertField(field(album.id(), "cover", "media-ref", 0));
        store.insertField(field(album.id(), "title", "string", 1));
        store.markMediaRefsPublic();
        assertThat(store.fieldsOf(album.id())).extracting(FieldRecord::fieldKey, FieldRecord::publicBytes)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("cover", true), org.assertj.core.groups.Tuple.tuple("title", false));
    }

    @Test
    void B08_entryRoundTripKeepsPayloadTypesAndNulls() {
        ContentTypeRecord album = insertType("album");
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "Coast");
        payload.put("count", 3);
        payload.put("flag", true);
        payload.put("nested", Map.of("k", "v"));
        payload.put("list", List.of("a", "b"));
        payload.put("cleared", null);
        EntryRecord entry = entry(album, "coast", PublicationState.PUBLISHED, payload, t(10));
        store.insertEntry(entry);
        EntryRecord found = store.findEntry(entry.id()).orElseThrow();
        assertThat(found).isEqualTo(entry);
        assertThat(found.payload()).containsEntry("cleared", null).containsEntry("count", 3);
    }

    @Test
    void B08_draftHasNullPublishedPayload() {
        ContentTypeRecord album = insertType("album");
        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(10));
        store.insertEntry(draft);
        assertThat(store.findEntry(draft.id()).orElseThrow().publishedPayload()).isNull();
    }

    @Test
    void B08_findBySlugIsScopedToTypeAndIncludesDeleted() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord page = insertType("page");
        EntryRecord a = entry(album, "same", PublicationState.DRAFT, Map.of("title", "A"), t(10));
        EntryRecord p = deleted(entry(page, "same", PublicationState.DRAFT, Map.of("title", "P"), t(11)), t(12));
        store.insertEntry(a);
        store.insertEntry(p);
        assertThat(store.findBySlug(album.id(), "same")).contains(a);
        assertThat(store.findBySlug(page.id(), "same")).contains(p);
        assertThat(store.findBySlug(album.id(), null)).isEmpty();
        assertThat(store.findBySlug(album.id(), "other")).isEmpty();
    }

    @Test
    void B08_listEntriesFiltersStatesAndDeletedNewestFirst() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord page = insertType("page");
        EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "d"), t(10));
        EntryRecord published = entry(album, "p", PublicationState.PUBLISHED, Map.of("title", "p"), t(30));
        EntryRecord archived = entry(album, "a", PublicationState.ARCHIVED, Map.of("title", "a"), t(20));
        EntryRecord gone = deleted(entry(album, "x", PublicationState.DRAFT, Map.of("title", "x"), t(40)), t(41));
        EntryRecord other = entry(page, "o", PublicationState.DRAFT, Map.of("title", "o"), t(50));
        List.of(draft, published, archived, gone, other).forEach(store::insertEntry);

        assertThat(store.listEntries(album.id(), List.of(), false, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("p", "a", "d");
        assertThat(store.listEntries(album.id(), List.of("draft", "published"), false, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("p", "d");
        assertThat(store.listEntries(album.id(), List.of(), true, null, null, null))
                .extracting(EntryRecord::slug).containsExactly("x", "p", "a", "d");
    }

    @Test
    void B08_listEntriesSearchIsCaseInsensitiveLiteralOnTitle() {
        ContentTypeRecord album = insertType("album");
        store.insertEntry(entry(album, "s1", PublicationState.DRAFT, Map.of("title", "Coast 50% Off"), t(10)));
        store.insertEntry(entry(album, "s2", PublicationState.DRAFT, Map.of("title", "Coast 500 off"), t(11)));
        store.insertEntry(entry(album, "s3", PublicationState.DRAFT, Map.of("title", "Beach_1"), t(12)));
        store.insertEntry(entry(album, "s4", PublicationState.DRAFT, Map.of("title", "BeachX1"), t(13)));
        store.insertEntry(entry(album, "s5", PublicationState.DRAFT, Map.of("name", "Coast"), t(14)));

        assertThat(slugs(album, "COAST")).containsExactly("s2", "s1");
        assertThat(slugs(album, "50%")).containsExactly("s1");
        assertThat(slugs(album, "h_1")).containsExactly("s3");
        assertThat(slugs(album, " ")).containsExactly("s5", "s4", "s3", "s2", "s1");
    }

    @Test
    void B08_listEntriesFiltersByRef() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord photo = insertType("photo");
        EntryRecord a1 = entry(album, "a1", PublicationState.DRAFT, Map.of("title", "a1"), t(1));
        EntryRecord a2 = entry(album, "a2", PublicationState.DRAFT, Map.of("title", "a2"), t(2));
        EntryRecord p1 = entry(photo, "p1", PublicationState.DRAFT, Map.of("album", a1.id().toString()), t(3));
        EntryRecord p2 = entry(photo, "p2", PublicationState.DRAFT, Map.of("album", a2.id().toString()), t(4));
        List.of(a1, a2, p1, p2).forEach(store::insertEntry);
        store.replaceRefs(p1.id(), List.of(new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0)));
        store.replaceRefs(p2.id(), List.of(new EntryRefRecord(p2.id(), "album", a2.id(), "entry", 0)));

        assertThat(store.listEntries(photo.id(), List.of(), false, null, "album", a1.id()))
                .extracting(EntryRecord::slug).containsExactly("p1");
        assertThat(store.listEntries(photo.id(), List.of(), false, null, "cover", a1.id())).isEmpty();
    }

    @Test
    void B08_countEntriesHonoursDeleted() {
        ContentTypeRecord album = insertType("album");
        store.insertEntry(entry(album, "a", PublicationState.DRAFT, Map.of(), t(1)));
        store.insertEntry(deleted(entry(album, "b", PublicationState.DRAFT, Map.of(), t(2)), t(3)));
        assertThat(store.countEntries(album.id(), false)).isEqualTo(1);
        assertThat(store.countEntries(album.id(), true)).isEqualTo(2);
    }

    @Test
    void B08_updateEntryReplacesMutableColumns() {
        ContentTypeRecord album = insertType("album");
        EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "old"), t(10));
        store.insertEntry(draft);
        UUID actor = UUID.randomUUID();
        EntryRecord next = new EntryRecord(draft.id(), album.id(), "album", "d2", PublicationState.PUBLISHED, 2,
                Map.of("title", "new"), Map.of("title", "new"), t(20), null, null, draft.createdBy(), actor,
                draft.createdAt(), t(20));
        store.updateEntry(next);
        assertThat(store.findEntry(draft.id())).contains(next);
    }

    @Test
    void B08_hardDeleteRemovesEntryRevisionsAndOutgoingRefs() {
        ContentTypeRecord album = insertType("album");
        EntryRecord target = entry(album, "t", PublicationState.DRAFT, Map.of(), t(1));
        EntryRecord source = entry(album, "s", PublicationState.PUBLISHED, Map.of("title", "s"), t(2));
        store.insertEntry(target);
        store.insertEntry(source);
        store.replaceRefs(source.id(), List.of(new EntryRefRecord(source.id(), "related", target.id(), "entry", 0)));
        store.insertRevision(revision(source, 1, t(2)));

        store.hardDeleteEntry(source.id());

        assertThat(store.findEntry(source.id())).isEmpty();
        assertThat(store.revisionsOf(source.id())).isEmpty();
        assertThat(store.refsTo(target.id())).isEmpty();
        assertThat(store.findEntry(target.id())).isPresent();
    }

    @Test
    void B08_revisionsNewestFirstAndPruned() {
        ContentTypeRecord album = insertType("album");
        EntryRecord e = entry(album, "e", PublicationState.PUBLISHED, Map.of("title", "e"), t(1));
        store.insertEntry(e);
        for (int no = 1; no <= 5; no++) {
            store.insertRevision(revision(e, no, t(no)));
        }
        assertThat(store.revisionsOf(e.id())).extracting(RevisionRecord::revisionNo).containsExactly(5, 4, 3, 2, 1);
        assertThat(store.revisionsOf(e.id()).getFirst()).usingRecursiveComparison().ignoringFields("id")
                .isEqualTo(revision(e, 5, t(5)));
        store.deleteOldestRevisions(e.id(), 2);
        assertThat(store.revisionsOf(e.id())).extracting(RevisionRecord::revisionNo).containsExactly(5, 4);
        store.deleteOldestRevisions(e.id(), 5);
        assertThat(store.revisionsOf(e.id())).hasSize(2);
    }

    @Test
    void B08_replaceRefsAndRefsTo() {
        ContentTypeRecord album = insertType("album");
        EntryRecord target = entry(album, "t", PublicationState.DRAFT, Map.of(), t(1));
        EntryRecord s1 = entry(album, "s1", PublicationState.DRAFT, Map.of(), t(2));
        EntryRecord s2 = entry(album, "s2", PublicationState.DRAFT, Map.of(), t(3));
        List.of(target, s1, s2).forEach(store::insertEntry);
        UUID media = UUID.randomUUID();
        store.replaceRefs(s1.id(), List.of(
                new EntryRefRecord(s1.id(), "related", target.id(), "entry", 0),
                new EntryRefRecord(s1.id(), "cover", media, "media", 0)));
        store.replaceRefs(s2.id(), List.of(new EntryRefRecord(s2.id(), "related", target.id(), "entry", 0)));

        assertThat(store.refsTo(target.id())).extracting(EntryRefRecord::fromEntryId)
                .containsExactlyInAnyOrder(s1.id(), s2.id());

        store.replaceRefs(s1.id(), List.of());
        assertThat(store.refsTo(target.id())).extracting(EntryRefRecord::fromEntryId).containsExactly(s2.id());
        assertThat(store.refsTo(media)).isEmpty();
    }

    @Test
    void B08_navigationUpsertAndFind() {
        assertThat(store.findNavigation("front.primary")).isEmpty();
        NavigationRecord draft = new NavigationRecord(UUID.randomUUID(), "front.primary", "front", "draft", 1,
                Map.of("items", List.of(Map.of("label", "A", "href", "/a"))), null, null, t(1));
        store.upsertNavigation(draft);
        assertThat(store.findNavigation("front.primary")).contains(draft);

        NavigationRecord published = new NavigationRecord(draft.id(), "front.primary", "front", "published", 2,
                draft.document(), draft.document(), UUID.randomUUID(), t(2));
        store.upsertNavigation(published);
        assertThat(store.findNavigation("front.primary")).contains(published);
    }

    // ---- fixtures ----

    protected static Instant t(int seconds) {
        return T0.plusSeconds(seconds);
    }

    protected static ContentTypeRecord type(String key) {
        return new ContentTypeRecord(UUID.randomUUID(), key, key + " one", key + " many", null, "title", "optional",
                false, true, true, List.of(), T0, T0);
    }

    protected ContentTypeRecord insertType(String key) {
        ContentTypeRecord type = type(key);
        store.insertType(type);
        return type;
    }

    protected static FieldRecord field(UUID typeId, String key, String fieldType, int sortOrder) {
        return new FieldRecord(UUID.randomUUID(), typeId, key, fieldType, false, false, false, "public", sortOrder,
                null, "restrict", List.of(), true, false);
    }

    protected static EntryRecord entry(ContentTypeRecord type, String slug, PublicationState state,
            Map<String, Object> payload, Instant updatedAt) {
        boolean published = state == PublicationState.PUBLISHED;
        return new EntryRecord(UUID.randomUUID(), type.id(), type.typeKey(), slug, state, 1, payload,
                published ? payload : null, published ? updatedAt : null, null, null, null, null, T0, updatedAt);
    }

    protected static EntryRecord deleted(EntryRecord e, Instant at) {
        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
                e.version(), e.payload(), e.publishedPayload(), e.publishedAt(), e.archivedAt(), at, e.createdBy(),
                e.updatedBy(), e.createdAt(), e.updatedAt());
    }

    protected static RevisionRecord revision(EntryRecord e, int no, Instant at) {
        return new RevisionRecord(UUID.randomUUID(), e.id(), no, e.slug(), Map.of("title", "rev" + no), at, null,
                e.contentTypeKey());
    }

    private List<String> slugs(ContentTypeRecord type, String q) {
        return store.listEntries(type.id(), List.of(), false, q, null, null).stream().map(EntryRecord::slug).toList();
    }
}
