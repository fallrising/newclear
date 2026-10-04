package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.RevisionRecord;
import com.fallrising.cms.content.index.IndexRow;
import com.fallrising.cms.content.index.IndexScope;
import com.fallrising.cms.content.query.AccessFilter;
import com.fallrising.cms.content.query.EntryPage;
import com.fallrising.cms.content.query.EntryQuery;
import com.fallrising.cms.content.query.FieldFilter;
import com.fallrising.cms.content.query.RefFilter;
import com.fallrising.cms.content.query.SortKey;
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
        ContentTypeRecord album = type("album").withSettings("rank", "shownTo", "owner", T0);
        store.insertType(album);
        ContentTypeRecord changed = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                "name", "none", true, false, false, List.of("cover"), t(50), t(60));
        store.updateType(changed);
        ContentTypeRecord expected = new ContentTypeRecord(album.id(), "album", "Albums!", "Many albums", "desc",
                album.titleField(), album.slugPolicy(), album.singleton(), false, album.previewable(),
                album.publicRequiresPublishedRefs(), album.createdAt(), t(60),
                album.sortField(), album.visibilityField(), album.ownerField());
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
        FieldRecord cover = field(album.id(), "cover", "media-ref", 0).withMetadata(
                "封面", "media", true, false, Map.of(), "選擇封面", "公開圖片");
        store.insertField(cover);
        store.insertField(field(album.id(), "title", "string", 1));
        store.markMediaRefsPublic();
        assertThat(store.fieldsOf(album.id())).extracting(FieldRecord::fieldKey, FieldRecord::publicBytes)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("cover", true), org.assertj.core.groups.Tuple.tuple("title", false));
        assertThat(store.fieldsOf(album.id())).contains(cover.withPublicBytes(true));
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
    void B08_queryWorkFiltersStatesAndExcludesDeletedNewestFirst() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord page = insertType("page");
        EntryRecord draft = entry(album, "d", PublicationState.DRAFT, Map.of("title", "d"), t(10));
        EntryRecord published = entry(album, "p", PublicationState.PUBLISHED, Map.of("title", "p"), t(30));
        EntryRecord archived = entry(album, "a", PublicationState.ARCHIVED, Map.of("title", "a"), t(20));
        EntryRecord gone = deleted(entry(album, "x", PublicationState.DRAFT, Map.of("title", "x"), t(40)), t(41));
        EntryRecord other = entry(page, "o", PublicationState.DRAFT, Map.of("title", "o"), t(50));
        List.of(draft, published, archived, gone, other).forEach(store::insertEntry);

        assertThat(workSlugs(query(album).states(List.of("draft", "published", "archived"))))
                .containsExactly("p", "a", "d");
        assertThat(workSlugs(query(album))).containsExactly("p", "d");
        assertThat(workSlugs(query(album).states(List.of()))).isEmpty();
    }

    @Test
    void B08_querySearchIsCaseInsensitiveLiteralOnTitle() {
        ContentTypeRecord album = insertType("album", field("title", "string"));
        store.insertEntry(entry(album, "s1", PublicationState.DRAFT, Map.of("title", "Coast 50% Off"), t(10)));
        store.insertEntry(entry(album, "s2", PublicationState.DRAFT, Map.of("title", "Coast 500 off"), t(11)));
        store.insertEntry(entry(album, "s3", PublicationState.DRAFT, Map.of("title", "Beach_1"), t(12)));
        store.insertEntry(entry(album, "s4", PublicationState.DRAFT, Map.of("title", "BeachX1"), t(13)));
        store.insertEntry(entry(album, "s5", PublicationState.DRAFT, Map.of("name", "Coast"), t(14)));

        assertThat(workSlugs(query(album).q("COAST"))).containsExactly("s2", "s1");
        assertThat(workSlugs(query(album).q("50%"))).containsExactly("s1");
        assertThat(workSlugs(query(album).q("h_1"))).containsExactly("s3");
        assertThat(workSlugs(query(album).q(" "))).containsExactly("s5", "s4", "s3", "s2", "s1");
    }

    @Test
    void B08_queryFiltersByRef() {
        ContentTypeRecord album = insertType("album");
        ContentTypeRecord photo = insertType("photo");
        EntryRecord a1 = entry(album, "a1", PublicationState.DRAFT, Map.of("title", "a1"), t(1));
        EntryRecord a2 = entry(album, "a2", PublicationState.DRAFT, Map.of("title", "a2"), t(2));
        EntryRecord p1 = entry(photo, "p1", PublicationState.DRAFT, Map.of("album", a1.id().toString()), t(3));
        EntryRecord p2 = entry(photo, "p2", PublicationState.DRAFT, Map.of("album", a2.id().toString()), t(4));
        List.of(a1, a2, p1, p2).forEach(store::insertEntry);
        store.replaceRefs(p1.id(), List.of(
                new EntryRefRecord(p1.id(), "album", a1.id(), "entry", 0),
                new EntryRefRecord(p1.id(), "related", a2.id(), "entry", 0)));
        store.replaceRefs(p2.id(), List.of(new EntryRefRecord(p2.id(), "album", a2.id(), "entry", 0)));

        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a1.id()))))).containsExactly("p1");
        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("cover", a1.id()))))).isEmpty();
        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a1.id()), new RefFilter("related", a2.id())))))
                .containsExactly("p1");
        assertThat(workSlugs(query(photo).refs(List.of(new RefFilter("album", a2.id()), new RefFilter("related", a2.id())))))
                .isEmpty();
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

    @Test
    void P0_sameVersionUpdateCannotOverwriteWinner() {
        ContentTypeRecord type = insertType("cas");
        EntryRecord original = entry(type, "original", PublicationState.DRAFT, Map.of("title", "old"), t(1));
        store.insertEntry(original);
        EntryRecord winner = new EntryRecord(original.id(), type.id(), type.typeKey(), "winner",
                PublicationState.DRAFT, 2, Map.of("title", "winner"), null, null, null, null,
                null, null, original.createdAt(), t(2));
        EntryRecord loser = new EntryRecord(original.id(), type.id(), type.typeKey(), "loser",
                PublicationState.PUBLISHED, 2, Map.of("title", "loser"), Map.of("title", "loser"),
                t(3), null, null, null, null, original.createdAt(), t(3));
        store.updateEntry(winner);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.updateEntry(loser))
                .isInstanceOf(com.fallrising.cms.content.ContentException.class)
                .hasMessage("Entry version does not match");
        assertThat(store.findEntry(original.id())).contains(winner);
    }

    @Test
    void P0_staleDeleteCannotRemoveNewerEntryOrDependents() {
        ContentTypeRecord type = insertType("delete_cas");
        EntryRecord original = entry(type, "original", PublicationState.DRAFT, Map.of(), t(1));
        store.insertEntry(original);
        RevisionRecord revision = revision(original, 1, t(1));
        store.insertRevision(revision);
        UUID target = UUID.randomUUID();
        store.replaceRefs(original.id(), List.of(new EntryRefRecord(original.id(), "cover", target, "media", 0)));
        EntryRecord newer = new EntryRecord(original.id(), type.id(), type.typeKey(), "newer",
                PublicationState.DRAFT, 2, Map.of(), null, null, null, null,
                null, null, original.createdAt(), t(2));
        store.updateEntry(newer);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.hardDeleteEntry(original.id(), 1))
                .isInstanceOf(com.fallrising.cms.content.ContentException.class);
        assertThat(store.findEntry(original.id())).contains(newer);
        assertThat(store.revisionsOf(original.id())).containsExactly(revision);
        assertThat(store.refsTo(target)).hasSize(1);
    }

    @Test
    void P0_competingUpdatesHaveExactlyOneWinner() throws Exception {
        ContentTypeRecord type = insertType("race");
        EntryRecord original = entry(type, "original", PublicationState.DRAFT, Map.of(), t(1));
        store.insertEntry(original);
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            java.util.List<java.util.concurrent.Future<String>> results = new java.util.ArrayList<>();
            for (String title : List.of("first", "second")) {
                results.add(executor.submit(() -> {
                    start.await();
                    EntryRecord next = new EntryRecord(original.id(), type.id(), type.typeKey(), original.slug(),
                            PublicationState.DRAFT, 2, Map.of("title", title), null, null, null, null,
                            null, null, original.createdAt(), t(2));
                    try {
                        store.updateEntry(next);
                        return title;
                    } catch (com.fallrising.cms.content.ContentException conflict) {
                        assertThat(conflict.getMessage()).isEqualTo("Entry version does not match");
                        return "conflict";
                    }
                }));
            }
            start.countDown();
            List<String> outcomes = List.of(results.get(0).get(10, java.util.concurrent.TimeUnit.SECONDS),
                    results.get(1).get(10, java.util.concurrent.TimeUnit.SECONDS));
            assertThat(outcomes).containsOnlyOnce("conflict");
            EntryRecord stored = store.findEntry(original.id()).orElseThrow();
            assertThat(stored.version()).isEqualTo(2);
            assertThat(outcomes).contains(stored.payload().get("title").toString());
        }
    }

    @Test
    void B03_typeSettingsRoundTrip() {
        ContentTypeRecord photo = type("photo").withSettings("sortOrder", "visibility", "ownerPrincipalId", T0);
        store.insertType(photo);
        assertThat(store.findTypeByKey("photo")).contains(photo);
    }

    @Test
    void B03_updateTypeSettingsChangesOnlySettings() {
        ContentTypeRecord album = type("album");
        store.insertType(album);
        ContentTypeRecord changed = new ContentTypeRecord(album.id(), "album", "Other", "Others", "desc", "name",
                "none", true, false, false, List.of("cover"), t(50), t(60), "sortOrder", "visibility", "owner");
        store.updateTypeSettings(changed);
        assertThat(store.findTypeByKey("album")).contains(album.withSettings("sortOrder", "visibility", "owner", t(60)));
    }

    @Test
    void B05_fieldMetadataRoundTrip() {
        ContentTypeRecord album = insertType("album");
        FieldRecord visibility = field(album.id(), "visibility", "enum", 0).withMetadata(
                "可見性", "settings", true, true, Map.of("public", "公開", "unlisted", "不公開列出"), "選一個", "說明文字");
        store.insertField(visibility);
        assertThat(store.fieldsOf(album.id())).containsExactly(visibility);
    }

    @Test
    void B05_updateFieldMetadataChangesOnlyMetadata() {
        ContentTypeRecord album = insertType("album");
        FieldRecord title = field(album.id(), "title", "string", 0);
        store.insertField(title);
        FieldRecord changed = new FieldRecord(title.id(), album.id(), "renamed", "int", true, true, true, "back", 9,
                "page", "cascade_soft", List.of("x"), false, true, "標題", "main", true, false, Map.of(), "輸入標題", "顯示在列表");
        store.updateFieldMetadata(changed);
        assertThat(store.fieldsOf(album.id())).containsExactly(
                title.withMetadata("標題", "main", true, false, Map.of(), "輸入標題", "顯示在列表"));
    }

    @Test
    void B03_searchUsesGivenTitleField() {
        ContentTypeRecord profile = insertType(type("clinic_profile", "name"), field("name", "string"), field("title", "string"));
        store.insertEntry(entry(profile, "c1", PublicationState.DRAFT, Map.of("name", "Cedar Clinic", "title", "zzz"), t(1)));
        store.insertEntry(entry(profile, "c2", PublicationState.DRAFT, Map.of("name", "Oak", "title", "Cedar"), t(2)));
        assertThat(workSlugs(query(profile).titleField("name").q("cedar"))).containsExactly("c1");
        assertThat(workSlugs(query(profile).titleField(null).q("cedar"))).isEmpty();
    }

    // ---- BW1b: index rows (B-09) ----

    @Test
    void B09_insertWritesWorkAndPublishedRowsByKind() {
        ContentTypeRecord event = insertType("event",
                field("title", "string"),
                indexed(field("status", "enum")),
                indexed(field("rank", "int")),
                indexed(field("featured", "boolean")),
                indexed(field("startsAt", "datetime")),
                indexed(field("venue", "ref")),
                indexed(field("host", "principal-ref")),
                indexed(field("cover", "media-ref")),
                field("notes", "markdown"));
        UUID venue = UUID.randomUUID();
        UUID host = UUID.randomUUID();
        Map<String, Object> working = new LinkedHashMap<>();
        working.put("title", "Night Market");
        working.put("status", "open");
        working.put("rank", 7);
        working.put("featured", true);
        working.put("startsAt", "2026-03-01T18:00:00+08:00");
        working.put("venue", venue.toString());
        working.put("host", host.toString());
        working.put("cover", UUID.randomUUID().toString());
        working.put("notes", "not indexed");
        EntryRecord e = published(entry(event, "m", PublicationState.PUBLISHED, working, t(5)), Map.of("title", "Old Title", "rank", 2));
        store.insertEntry(e);

        assertThat(store.indexRowsOf(e.id())).containsExactly(
                row(e, "rank", IndexScope.PUBLISHED, "int", null, 2L, null, null),
                row(e, "title", IndexScope.PUBLISHED, "string", "Old Title", null, null, null),
                row(e, "featured", IndexScope.WORK, "bool", null, null, true, null),
                row(e, "host", IndexScope.WORK, "ref", host.toString(), null, null, null),
                row(e, "rank", IndexScope.WORK, "int", null, 7L, null, null),
                row(e, "startsAt", IndexScope.WORK, "datetime", null, null, null, Instant.parse("2026-03-01T10:00:00Z")),
                row(e, "status", IndexScope.WORK, "enum", "open", null, null, null),
                row(e, "title", IndexScope.WORK, "string", "Night Market", null, null, null),
                row(e, "venue", IndexScope.WORK, "ref", venue.toString(), null, null, null));
    }

    @Test
    void B09_nullBlankAndWrongJsonTypesGetNoRow() {
        ContentTypeRecord event = insertType("event",
                field("title", "string"), indexed(field("rank", "int")), indexed(field("featured", "boolean")),
                indexed(field("startsAt", "datetime")), indexed(field("status", "enum")));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "  ");
        payload.put("rank", "7");
        payload.put("featured", "true");
        payload.put("startsAt", "next friday");
        payload.put("status", null);
        EntryRecord e = entry(event, "x", PublicationState.DRAFT, payload, t(1));
        store.insertEntry(e);
        assertThat(store.indexRowsOf(e.id())).isEmpty();
    }

    @Test
    void B09_updateReplacesRowsAndUnpublishDropsPublishedRows() {
        ContentTypeRecord album = insertType("album", field("title", "string"));
        EntryRecord e = entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "First"), t(1));
        store.insertEntry(e);
        EntryRecord unpublished = new EntryRecord(e.id(), album.id(), "album", "a", PublicationState.DRAFT, 2,
                Map.of("title", "Second"), null, null, null, null, null, null, T0, t(2));
        store.updateEntry(unpublished);
        assertThat(store.indexRowsOf(e.id())).containsExactly(
                row(e, "title", IndexScope.WORK, "string", "Second", null, null, null));
    }

    @Test
    void B09_typeSettingsAndNewFieldsReindexExistingEntries() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"), field("sortOrder", "int"));
        EntryRecord e = entry(photo, "p", PublicationState.DRAFT, Map.of("title", "P", "sortOrder", 3, "caption", "C"), t(1));
        store.insertEntry(e);
        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("title");

        store.updateTypeSettings(photo.withSettings("sortOrder", null, null, t(2)));
        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("sortOrder", "title");

        store.insertField(indexed(field(photo.id(), "caption", "string", 5)));
        assertThat(store.indexRowsOf(e.id())).extracting(IndexRow::fieldKey).containsExactly("caption", "sortOrder", "title");
    }

    @Test
    void B09_hardDeleteRemovesRows() {
        ContentTypeRecord album = insertType("album", field("title", "string"));
        EntryRecord e = entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "A"), t(1));
        store.insertEntry(e);
        store.hardDeleteEntry(e.id());
        assertThat(store.indexRowsOf(e.id())).isEmpty();
    }

    // ---- BW1b: paging, sorting, filters, public rules (B-02) ----

    @Test
    void B02_pagesReportTotalOfAllPages() {
        ContentTypeRecord album = insertType("album", field("title", "string"));
        for (int i = 1; i <= 5; i++) {
            store.insertEntry(entry(album, "e" + i, PublicationState.DRAFT, Map.of("title", "E" + i), t(i)));
        }
        EntryPage second = store.queryEntries(query(album).page(2).size(2).build());
        assertThat(second.total()).isEqualTo(5);
        assertThat(second.items()).extracting(EntryRecord::slug).containsExactly("e3", "e2");
        assertThat(workSlugs(query(album).page(3).size(2))).containsExactly("e1");
        EntryPage beyond = store.queryEntries(query(album).page(4).size(2).build());
        assertThat(beyond.items()).isEmpty();
        assertThat(beyond.total()).isEqualTo(5);
        EntryPage farBeyond = store.queryEntries(query(album).page(Integer.MAX_VALUE).size(100).build());
        assertThat(farBeyond.items()).isEmpty();
        assertThat(farBeyond.total()).isEqualTo(5);
    }

    @Test
    void B02_sortsBySystemColumnsWithNullsLastAndTieBreaks() {
        ContentTypeRecord album = insertType("album", field("title", "string"));
        EntryRecord old = withCreated(entry(album, "old", PublicationState.PUBLISHED, Map.of("title", "O"), t(30)), t(-10));
        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(20));
        EntryRecord fresh = entry(album, "fresh", PublicationState.PUBLISHED, Map.of("title", "F"), t(10));
        List.of(old, draft, fresh).forEach(store::insertEntry);

        assertThat(workSlugs(query(album).sort(SortKey.system("updatedAt", false)))).containsExactly("fresh", "draft", "old");
        assertThat(workSlugs(query(album).sort(SortKey.system("createdAt", false)))).containsExactly("old", "draft", "fresh");
        assertThat(workSlugs(query(album).sort(SortKey.system("publishedAt", true)))).containsExactly("old", "fresh", "draft");
        assertThat(workSlugs(query(album).sort(SortKey.system("publishedAt", false)))).containsExactly("fresh", "old", "draft");
    }

    @Test
    void B03_sortFieldAscendingPreservesFractionsThenNewestUpdate() {
        ContentTypeRecord photo = insertType(type("photo").withSettings("rank", null, null, T0),
                field("title", "string"), field("rank", "int"));
        List.of(
                entry(photo, "b", PublicationState.PUBLISHED, Map.of("rank", 2), t(1)),
                entry(photo, "fraction", PublicationState.PUBLISHED, Map.of("rank", 1.5), t(1)),
                entry(photo, "none", PublicationState.PUBLISHED, Map.of(), t(9)),
                entry(photo, "a2", PublicationState.PUBLISHED, Map.of("rank", 1), t(1)),
                entry(photo, "a1", PublicationState.PUBLISHED, Map.of("rank", 1), t(5)),
                entry(photo, "text", PublicationState.PUBLISHED, Map.of("rank", "1"), t(8)))
                .forEach(store::insertEntry);
        assertThat(publicSlugs(publicQuery(photo).sort(SortKey.field("rank", "int", false))))
                .containsExactly("a1", "a2", "fraction", "b", "none", "text");
        assertThat(workSlugs(query(photo).filters(List.of(FieldFilter.equalsValue("rank", "int", 1L)))))
                .containsExactly("a1", "a2");
    }

    @Test
    void B02_numericEqualsComparesDecimalValueWithoutScale() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"), indexed(field("rank", "int")));
        store.insertEntry(entry(photo, "whole", PublicationState.DRAFT, Map.of("rank", 1), t(1)));
        store.insertEntry(entry(photo, "decimal", PublicationState.DRAFT, Map.of("rank", 1.0), t(2)));
        store.insertEntry(entry(photo, "fraction", PublicationState.DRAFT, Map.of("rank", 1.1), t(3)));
        assertThat(workSlugs(query(photo).filters(List.of(FieldFilter.equalsValue("rank", "int", 1L)))))
                .containsExactly("decimal", "whole");
    }

    @Test
    void B03_withoutSortFieldNewestPublishFirst() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"));
        EntryRecord old = new EntryRecord(UUID.randomUUID(), photo.id(), photo.typeKey(), "old",
                PublicationState.PUBLISHED, 1, Map.of("sortOrder", 1), Map.of("sortOrder", 1),
                t(1), null, null, null, null, T0, t(50));
        List.of(old, entry(photo, "new", PublicationState.PUBLISHED, Map.of("sortOrder", 9), t(3)),
                entry(photo, "mid", PublicationState.PUBLISHED, Map.of(), t(2))).forEach(store::insertEntry);
        assertThat(publicSlugs(publicQuery(photo).sort(SortKey.system("publishedAt", true))))
                .containsExactly("new", "mid", "old");
    }

    @Test
    void B03_publicTimestampTiesUseUpdateAndNullTimestampsComeLast() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"));
        EntryRecord missingPublish = entry(photo, "missing", PublicationState.PUBLISHED, Map.of(), t(90));
        missingPublish = new EntryRecord(missingPublish.id(), photo.id(), photo.typeKey(), "missing",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), null, null, null, null, null, T0, t(90));
        Instant missingUpdate = store instanceof com.fallrising.cms.content.store.InMemoryContentStore ? null : t(0);
        EntryRecord noUpdate = new EntryRecord(UUID.randomUUID(), photo.id(), photo.typeKey(), "no-update",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), t(3), null, null, null, null, T0, missingUpdate);
        EntryRecord olderUpdate = new EntryRecord(UUID.randomUUID(), photo.id(), photo.typeKey(), "older-update",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), t(3), null, null, null, null, T0, t(4));
        EntryRecord newerUpdate = new EntryRecord(UUID.randomUUID(), photo.id(), photo.typeKey(), "newer-update",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), t(3), null, null, null, null, T0, t(8));
        List.of(missingPublish, noUpdate, olderUpdate, newerUpdate).forEach(store::insertEntry);
        assertThat(publicSlugs(publicQuery(photo).sort(SortKey.system("publishedAt", true))))
                .containsExactly("newer-update", "older-update", "no-update", "missing");
    }

    @Test
    void B02_fieldSortPutsMissingValuesLastInBothDirections() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"), indexed(field("rank", "int")));
        store.insertEntry(entry(photo, "r2", PublicationState.DRAFT, Map.of("title", "b", "rank", 2), t(1)));
        store.insertEntry(entry(photo, "r10", PublicationState.DRAFT, Map.of("title", "B", "rank", 10), t(2)));
        store.insertEntry(entry(photo, "none-old", PublicationState.DRAFT, Map.of("title", "a"), t(3)));
        store.insertEntry(entry(photo, "none-new", PublicationState.DRAFT, Map.of("title", "é"), t(4)));

        assertThat(workSlugs(query(photo).sort(SortKey.field("rank", "int", false))))
                .containsExactly("r2", "r10", "none-new", "none-old");
        assertThat(workSlugs(query(photo).sort(SortKey.field("rank", "int", true))))
                .containsExactly("r10", "r2", "none-new", "none-old");
        assertThat(workSlugs(query(photo).sort(SortKey.field("title", "string", false))))
                .containsExactly("r10", "none-old", "r2", "none-new");
    }

    @Test
    void B02_equalTiesAreOrderedByUpdatedAtThenIdText() {
        ContentTypeRecord photo = insertType("photo", field("title", "string"));
        List<EntryRecord> same = new java.util.ArrayList<>();
        for (int i = 0; i < 4; i++) {
            EntryRecord e = entry(photo, "s" + i, PublicationState.DRAFT, Map.of("title", "same"), t(7));
            store.insertEntry(e);
            same.add(e);
        }
        List<String> byId = same.stream().sorted(java.util.Comparator.comparing(e -> e.id().toString()))
                .map(EntryRecord::slug).toList();
        assertThat(workSlugs(query(photo).sort(SortKey.field("title", "string", false)))).containsExactlyElementsOf(byId);
        assertThat(workSlugs(query(photo))).containsExactlyElementsOf(byId);
    }

    @Test
    void B02_fieldFiltersCompareByKind() {
        ContentTypeRecord event = insertType("event", field("title", "string"), indexed(field("status", "enum")),
                indexed(field("rank", "int")), indexed(field("featured", "boolean")));
        store.insertEntry(entry(event, "a", PublicationState.DRAFT, Map.of("title", "A", "status", "open", "rank", 1, "featured", true), t(1)));
        store.insertEntry(entry(event, "b", PublicationState.DRAFT, Map.of("title", "B", "status", "closed", "rank", 1, "featured", false), t(2)));
        store.insertEntry(entry(event, "c", PublicationState.DRAFT, Map.of("title", "C", "status", "open", "rank", 2), t(3)));

        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("status", "enum", "open"))))).containsExactly("c", "a");
        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("rank", "int", 1L))))).containsExactly("b", "a");
        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("featured", "bool", false))))).containsExactly("b");
        assertThat(workSlugs(query(event).filters(List.of(
                FieldFilter.equalsValue("status", "enum", "open"), FieldFilter.equalsValue("rank", "int", 1L))))).containsExactly("a");
        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.equalsValue("status", "enum", "Open"))))).isEmpty();
    }

    @Test
    void B02_datetimeRangeIsFromInclusiveToExclusive() {
        ContentTypeRecord event = insertType("event", field("title", "string"), indexed(field("startsAt", "datetime")));
        store.insertEntry(entry(event, "jan", PublicationState.DRAFT, Map.of("title", "J", "startsAt", "2026-01-01T00:00:00Z"), t(1)));
        store.insertEntry(entry(event, "feb", PublicationState.DRAFT, Map.of("title", "F", "startsAt", "2026-02-01T00:00:00Z"), t(2)));
        store.insertEntry(entry(event, "none", PublicationState.DRAFT, Map.of("title", "N"), t(3)));
        Instant jan = Instant.parse("2026-01-01T00:00:00Z");
        Instant feb = Instant.parse("2026-02-01T00:00:00Z");

        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", jan, feb))))).containsExactly("jan");
        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", feb, null))))).containsExactly("feb");
        assertThat(workSlugs(query(event).filters(List.of(FieldFilter.range("startsAt", null, feb))))).containsExactly("jan");
    }

    @Test
    void B02_publishedScopeUsesPublishedCopyForSearchFilterAndSort() {
        ContentTypeRecord album = insertType("album", field("title", "string"), indexed(field("rank", "int")));
        EntryRecord a = published(entry(album, "a", PublicationState.PUBLISHED, Map.of("title", "Draft words", "rank", 1), t(1)),
                Map.of("title", "Live words", "rank", 9));
        EntryRecord b = entry(album, "b", PublicationState.PUBLISHED, Map.of("title", "Live too", "rank", 5), t(2));
        List.of(a, b).forEach(store::insertEntry);

        assertThat(publicSlugs(publicQuery(album).q("live"))).containsExactly("b", "a");
        assertThat(publicSlugs(publicQuery(album).q("draft"))).isEmpty();
        assertThat(workSlugs(query(album).q("draft"))).containsExactly("a");
        assertThat(publicSlugs(publicQuery(album).filters(List.of(FieldFilter.equalsValue("rank", "int", 9L))))).containsExactly("a");
        assertThat(publicSlugs(publicQuery(album).sort(SortKey.field("rank", "int", false)))).containsExactly("b", "a");
    }

    @Test
    void B02_publishedScopeKeepsOnlyPublishedPublicEntries() {
        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
                field("title", "string"), field("visibility", "enum"));
        EntryRecord pub = entry(album, "pub", PublicationState.PUBLISHED, Map.of("title", "P", "visibility", "public"), t(1));
        EntryRecord missing = entry(album, "missing", PublicationState.PUBLISHED, Map.of("title", "M"), t(2));
        EntryRecord unlisted = entry(album, "unlisted", PublicationState.PUBLISHED, Map.of("title", "U", "visibility", "unlisted"), t(3));
        EntryRecord secret = entry(album, "private", PublicationState.PUBLISHED, Map.of("title", "S", "visibility", "private"), t(4));
        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(5));
        EntryRecord archived = entry(album, "archived", PublicationState.ARCHIVED, Map.of("title", "A"), t(6));
        EntryRecord gone = deleted(entry(album, "gone", PublicationState.PUBLISHED, Map.of("title", "G"), t(7)), t(8));
        List.of(pub, missing, unlisted, secret, draft, archived, gone).forEach(store::insertEntry);

        assertThat(publicSlugs(publicQuery(album).visibilityField("visibility"))).containsExactly("missing", "pub");
        assertThat(publicSlugs(publicQuery(album))).containsExactly("private", "unlisted", "missing", "pub");
    }

    @Test
    void B02_visibilityControlAppliesWhenFieldIsDisabledOrMalformed() {
        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
                field("title", "string"));
        FieldRecord disabled = field(album.id(), "visibility", "enum", 1);
        disabled = new FieldRecord(disabled.id(), album.id(), "visibility", "enum", false, false, false,
                "public", 1, null, "restrict", List.of(), false, false);
        store.insertField(disabled);
        List.of(entry(album, "private", PublicationState.PUBLISHED, Map.of("visibility", "private"), t(1)),
                entry(album, "malformed-map", PublicationState.PUBLISHED, Map.of("visibility", Map.of("x", "private")), t(2)),
                entry(album, "malformed-list", PublicationState.PUBLISHED, Map.of("visibility", List.of("private")), t(3)),
                entry(album, "number", PublicationState.PUBLISHED, Map.of("visibility", 42), t(4)),
                entry(album, "blank", PublicationState.PUBLISHED, Map.of("visibility", "  "), t(5)),
                entry(album, "public", PublicationState.PUBLISHED, Map.of("visibility", "public"), t(6)),
                entry(album, "missing", PublicationState.PUBLISHED, Map.of(), t(7))).forEach(store::insertEntry);
        assertThat(publicSlugs(publicQuery(album).visibilityField("visibility")))
                .containsExactly("missing", "public", "blank");
    }

    @Test
    void B02_requiredRefsUsePublishedPayloadWhenIndexRowsAreAbsent() {
        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
                field("title", "string"));
        ContentTypeRecord photo = insertType(type("photo", "title", List.of("album")), field("title", "string"));
        FieldRecord ref = field(photo.id(), "album", "ref", 1);
        store.insertField(new FieldRecord(ref.id(), photo.id(), "album", "ref", false, false, false,
                "public", 1, "album", "restrict", List.of(), false, false));
        EntryRecord secret = entry(album, "secret", PublicationState.PUBLISHED, Map.of("visibility", "private"), t(1));
        EntryRecord open = entry(album, "open", PublicationState.PUBLISHED, Map.of("visibility", "unlisted"), t(2));
        List.of(secret, open).forEach(store::insertEntry);
        List.of(entry(photo, "private-target", PublicationState.PUBLISHED, Map.of("album", secret.id().toString()), t(3)),
                entry(photo, "blank", PublicationState.PUBLISHED, Map.of("album", "  "), t(4)),
                entry(photo, "map", PublicationState.PUBLISHED, Map.of("album", Map.of("id", open.id().toString())), t(5)),
                entry(photo, "list", PublicationState.PUBLISHED, Map.of("album", List.of(open.id().toString())), t(6)),
                entry(photo, "valid", PublicationState.PUBLISHED, Map.of("album", open.id().toString()), t(7)),
                entry(photo, "missing", PublicationState.PUBLISHED, Map.of(), t(8))).forEach(store::insertEntry);
        assertThat(publicSlugs(publicQuery(photo).requiredRefs(List.of("album"))))
                .containsExactly("missing", "valid");
    }

    @Test
    void B02_requiredRefsMustPointToPubliclyReadableEntries() {
        ContentTypeRecord album = insertType(type("album").withSettings(null, "visibility", null, T0),
                field("title", "string"), field("visibility", "enum"));
        ContentTypeRecord photo = insertType(type("photo", "title", List.of("album")), field("title", "string"), field("album", "ref"));
        EntryRecord open = entry(album, "open", PublicationState.PUBLISHED, Map.of("title", "O", "visibility", "public"), t(1));
        EntryRecord unlisted = entry(album, "unlisted", PublicationState.PUBLISHED, Map.of("title", "U", "visibility", "unlisted"), t(2));
        EntryRecord secret = entry(album, "secret", PublicationState.PUBLISHED, Map.of("title", "S", "visibility", "private"), t(3));
        EntryRecord draft = entry(album, "draft", PublicationState.DRAFT, Map.of("title", "D"), t(4));
        EntryRecord gone = deleted(entry(album, "gone", PublicationState.PUBLISHED, Map.of("title", "G"), t(5)), t(6));
        List.of(open, unlisted, secret, draft, gone).forEach(store::insertEntry);
        store.insertEntry(entry(photo, "in-open", PublicationState.PUBLISHED, Map.of("title", "1", "album", open.id().toString()), t(11)));
        store.insertEntry(entry(photo, "in-unlisted", PublicationState.PUBLISHED, Map.of("title", "2", "album", unlisted.id().toString()), t(12)));
        store.insertEntry(entry(photo, "in-secret", PublicationState.PUBLISHED, Map.of("title", "3", "album", secret.id().toString()), t(13)));
        store.insertEntry(entry(photo, "in-draft", PublicationState.PUBLISHED, Map.of("title", "4", "album", draft.id().toString()), t(14)));
        store.insertEntry(entry(photo, "in-gone", PublicationState.PUBLISHED, Map.of("title", "5", "album", gone.id().toString()), t(15)));
        store.insertEntry(entry(photo, "in-missing", PublicationState.PUBLISHED, Map.of("title", "6", "album", UUID.randomUUID().toString()), t(16)));
        store.insertEntry(entry(photo, "in-garbage", PublicationState.PUBLISHED, Map.of("title", "7", "album", "not-a-uuid"), t(17)));
        store.insertEntry(entry(photo, "in-upper", PublicationState.PUBLISHED, Map.of("title", "8", "album", open.id().toString().toUpperCase()), t(18)));
        store.insertEntry(entry(photo, "loose", PublicationState.PUBLISHED, Map.of("title", "9"), t(19)));

        assertThat(publicSlugs(publicQuery(photo).requiredRefs(List.of("album")))).containsExactly("loose", "in-unlisted", "in-open");
    }

    // ---- BW1b: authorization pushdown (B-10) ----

    @Test
    void B10_accessFilterKeepsEntriesMatchingAnyClause() {
        ContentTypeRecord pet = insertType(type("pet").withSettings(null, null, "ownerPrincipalId", T0),
                field("title", "string"), field("ownerPrincipalId", "principal-ref"), indexed(field("clinic", "string")));
        UUID me = UUID.randomUUID();
        store.insertEntry(entry(pet, "mine", PublicationState.DRAFT, Map.of("title", "M", "ownerPrincipalId", me.toString()), t(1)));
        store.insertEntry(entry(pet, "branch", PublicationState.DRAFT, Map.of("title", "B", "ownerPrincipalId", UUID.randomUUID().toString(), "clinic", "north"), t(2)));
        store.insertEntry(entry(pet, "other", PublicationState.DRAFT, Map.of("title", "O", "ownerPrincipalId", UUID.randomUUID().toString()), t(3)));

        assertThat(workSlugs(query(pet).access(AccessFilter.none()))).containsExactly("other", "branch", "mine");
        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of(new AccessFilter.Clause("ownerPrincipalId", me.toString()))))))
                .containsExactly("mine");
        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of(
                new AccessFilter.Clause("ownerPrincipalId", me.toString()), new AccessFilter.Clause("clinic", "north"))))))
                .containsExactly("branch", "mine");
        assertThat(workSlugs(query(pet).access(AccessFilter.anyOf(List.of())))).isEmpty();
        EntryPage none = store.queryEntries(query(pet).access(AccessFilter.anyOf(List.of())).build());
        assertThat(none.total()).isZero();
    }

    @Test
    void B10_accessFilterReadsRowsOfTheQueryScope() {
        ContentTypeRecord pet = insertType(type("pet").withSettings(null, null, "ownerPrincipalId", T0),
                field("title", "string"), field("ownerPrincipalId", "principal-ref"));
        UUID me = UUID.randomUUID();
        EntryRecord moved = published(entry(pet, "moved", PublicationState.PUBLISHED,
                Map.of("title", "M", "ownerPrincipalId", UUID.randomUUID().toString()), t(1)),
                Map.of("title", "M", "ownerPrincipalId", me.toString()));
        store.insertEntry(moved);
        AccessFilter mine = AccessFilter.anyOf(List.of(new AccessFilter.Clause("ownerPrincipalId", me.toString())));
        assertThat(publicSlugs(publicQuery(pet).access(mine))).containsExactly("moved");
        assertThat(workSlugs(query(pet).access(mine))).isEmpty();
    }

    // ---- fixtures ----

    protected static Instant t(int seconds) {
        return T0.plusSeconds(seconds);
    }

    @Test
    void G03_publishRequestsRoundTripClearAndFilterOnlyWorkQueries() {
        ContentTypeRecord album = insertType("album");
        UUID actor = UUID.randomUUID();
        EntryRecord requested = entry(album, "requested", PublicationState.PUBLISHED, Map.of("title", "requested"), t(1))
                .withPublishRequest(t(2), actor);
        EntryRecord plain = entry(album, "plain", PublicationState.PUBLISHED, Map.of("title", "plain"), t(3));
        store.insertEntry(requested); store.insertEntry(plain);
        assertThat(store.findEntry(requested.id())).contains(requested);
        assertThat(store.queryEntries(query(album).publishRequested(true).build()).items()).containsExactly(requested);
        assertThat(store.queryEntries(query(album).publishRequested(false).build()).total()).isEqualTo(2);
        assertThat(store.queryEntries(publicQuery(album).publishRequested(true).build()).total()).isEqualTo(2);
        EntryRecord cleared = new EntryRecord(requested.id(), requested.contentTypeId(), requested.contentTypeKey(), requested.slug(),
                requested.publicationState(), requested.version() + 1, requested.payload(), requested.publishedPayload(), requested.publishedAt(),
                requested.archivedAt(), requested.deletedAt(), requested.createdBy(), requested.updatedBy(), requested.createdAt(), t(4));
        store.updateEntry(cleared);
        assertThat(store.findEntry(requested.id())).contains(cleared);
        assertThat(store.queryEntries(query(album).publishRequested(true).build()).items()).isEmpty();
    }

    @Test
    void G10_findEntriesReadsDistinctTargetsIncludingDeletedAndOmitsMissing() {
        ContentTypeRecord album = insertType("album");
        EntryRecord a = entry(album, "a", PublicationState.DRAFT, Map.of("title", "a"), t(1));
        EntryRecord b = deleted(entry(album, "b", PublicationState.DRAFT, Map.of("title", "b"), t(2)), t(3));
        store.insertEntry(a); store.insertEntry(b);
        assertThat(store.findEntries(List.of(a.id(), b.id(), a.id(), UUID.randomUUID())))
                .containsOnlyKeys(a.id(), b.id()).containsEntry(a.id(), a).containsEntry(b.id(), b);
        assertThat(store.findEntries(List.of())).isEmpty();
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

    protected static ContentTypeRecord type(String key, String titleField) {
        return type(key, titleField, List.of());
    }

    protected static ContentTypeRecord type(String key, String titleField, List<String> requiredRefs) {
        return new ContentTypeRecord(UUID.randomUUID(), key, key + " one", key + " many", null, titleField, "optional",
                false, true, true, requiredRefs, T0, T0);
    }

    /** Inserts the type and one field per spec; FieldSpec.typeId is filled in here. */
    protected ContentTypeRecord insertType(String key, FieldSpec... specs) {
        return insertType(type(key), specs);
    }

    protected ContentTypeRecord insertType(ContentTypeRecord type, FieldSpec... specs) {
        store.insertType(type);
        int order = 0;
        for (FieldSpec spec : specs) {
            FieldRecord f = field(type.id(), spec.key(), spec.fieldType(), order++);
            store.insertField(spec.indexed() ? indexed(f) : f);
        }
        return type;
    }

    protected record FieldSpec(String key, String fieldType, boolean indexed) {}

    protected static FieldSpec field(String key, String fieldType) {
        return new FieldSpec(key, fieldType, false);
    }

    protected static FieldSpec indexed(FieldSpec spec) {
        return new FieldSpec(spec.key(), spec.fieldType(), true);
    }

    protected static FieldRecord indexed(FieldRecord f) {
        return new FieldRecord(f.id(), f.contentTypeId(), f.fieldKey(), f.fieldType(), f.required(), f.uniqueInType(), true,
                f.visibility(), f.sortOrder(), f.refTargetTypeKey(), f.onDelete(), f.enumValues(), f.enabled(), f.publicBytes());
    }

    protected static EntryRecord published(EntryRecord e, Map<String, Object> publishedPayload) {
        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
                e.version(), e.payload(), publishedPayload, e.publishedAt(), e.archivedAt(), e.deletedAt(), e.createdBy(),
                e.updatedBy(), e.createdAt(), e.updatedAt());
    }

    protected static EntryRecord withCreated(EntryRecord e, Instant createdAt) {
        return new EntryRecord(e.id(), e.contentTypeId(), e.contentTypeKey(), e.slug(), e.publicationState(),
                e.version(), e.payload(), e.publishedPayload(), e.publishedAt(), e.archivedAt(), e.deletedAt(), e.createdBy(),
                e.updatedBy(), createdAt, e.updatedAt());
    }

    protected static IndexRow row(EntryRecord e, String key, IndexScope scope, String kind, String s, Long i, Boolean b, Instant ts) {
        return new IndexRow(e.id(), key, scope, kind, s, i, b, ts);
    }

    /** Work query on the type: states draft+published, newest update first, page 1 of 100, no other condition. */
    protected static QueryBuilder query(ContentTypeRecord type) {
        return new QueryBuilder(type, IndexScope.WORK);
    }

    /** Published query on the type: no visibilityField and no requiredRefs unless set. */
    protected static QueryBuilder publicQuery(ContentTypeRecord type) {
        return new QueryBuilder(type, IndexScope.PUBLISHED);
    }

    private List<String> workSlugs(QueryBuilder query) {
        return store.queryEntries(query.build()).items().stream().map(EntryRecord::slug).toList();
    }

    private List<String> publicSlugs(QueryBuilder query) {
        return workSlugs(query);
    }

    protected static final class QueryBuilder {
        private final ContentTypeRecord type;
        private final IndexScope scope;
        private List<String> states = List.of("draft", "published");
        private String titleField;
        private String q;
        private List<FieldFilter> filters = List.of();
        private List<RefFilter> refs = List.of();
        private AccessFilter access = AccessFilter.none();
        private String visibilityField;
        private List<String> requiredRefs = List.of();
        private SortKey sort = SortKey.system("updatedAt", true);
        private int page = 1;
        private int size = 100;
        private boolean publishRequested;

        QueryBuilder(ContentTypeRecord type, IndexScope scope) {
            this.type = type;
            this.scope = scope;
            this.titleField = type.titleField();
        }

        QueryBuilder states(List<String> v) { states = v; return this; }
        QueryBuilder titleField(String v) { titleField = v; return this; }
        QueryBuilder q(String v) { q = v; return this; }
        QueryBuilder filters(List<FieldFilter> v) { filters = v; return this; }
        QueryBuilder refs(List<RefFilter> v) { refs = v; return this; }
        QueryBuilder access(AccessFilter v) { access = v; return this; }
        QueryBuilder visibilityField(String v) { visibilityField = v; return this; }
        QueryBuilder requiredRefs(List<String> v) { requiredRefs = v; return this; }
        QueryBuilder sort(SortKey v) { sort = v; return this; }
        QueryBuilder page(int v) { page = v; return this; }
        QueryBuilder size(int v) { size = v; return this; }
        QueryBuilder publishRequested(boolean v) { publishRequested = v; return this; }

        EntryQuery build() {
            return new EntryQuery(type.id(), scope, states, titleField, q, filters, refs, access, visibilityField,
                    requiredRefs, sort, page, size, publishRequested);
        }
    }
}
