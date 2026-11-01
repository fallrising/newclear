package com.fallrising.cms.contract;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.service.MediaService;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real PostgreSQL checks for entry/ref/media/revision/audit transaction boundaries. */
class EntryAtomicWriteTests {
    private JdbcTemplate jdbc;
    private JdbcContentStore store;
    private JdbcMediaStore media;
    private IdentityStore identity;
    private JdbcIdentityStore auditStore;
    private EntryService service;
    private MediaService mediaService;
    private ContentTypeRecord type;

    @BeforeEach
    void setUp() {
        var dataSource = PostgresFixture.cleanDataSource();
        jdbc = new JdbcTemplate(dataSource);
        store = new JdbcContentStore(dataSource, new ObjectMapper());
        media = new JdbcMediaStore(dataSource);
        identity = mock(IdentityStore.class);
        auditStore = new JdbcIdentityStore(dataSource, null);
        var authorization = mock(AuthorizationService.class);
        mediaService = new MediaService(media, null, store, authorization);
        service = new EntryService(store, authorization, identity, mediaService);
        type = ContentStoreContract.type("atomic");
        store.insertType(type);
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "cover", "media-ref", false, false,
                false, "public", 1, null, "restrict", List.of(), true, true));
    }

    @Test
    void createIndexFailureRollsBackEntryRefsAttachmentsAndAudit() {
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "title", "string", false, false,
                true, "public", 0, null, "restrict", List.of(), true, false));
        UUID cover = insertMedia();
        jdbc.execute("ALTER TABLE cms_entry_index ADD CONSTRAINT injected_index_failure CHECK (value_string <> 'blocked')");
        assertThatThrownBy(() -> service.create(null, Surface.BACK, type.typeKey(), "failed-index",
                Map.of("title", "blocked", "cover", cover.toString())))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.countEntries(type.id(), true)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_entry_index", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_entry_ref", Long.class)).isZero();
        assertThat(media.attachmentsOfMedia(cover)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class)).isZero();
    }

    @Test
    void patchIndexFailurePreservesVersionBothScopesRefsAttachmentsAndRevisions() {
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "title", "string", false, false,
                true, "public", 0, null, "restrict", List.of(), true, false));
        UUID cover = insertMedia();
        EntryRecord draft = service.create(null, Surface.BACK, type.typeKey(), "indexed",
                Map.of("title", "Original", "cover", cover.toString()));
        service.publish(null, Surface.BACK, draft.id());
        EntryRecord before = store.findEntry(draft.id()).orElseThrow();
        var rows = store.indexRowsOf(before.id());
        var revisions = store.revisionsOf(before.id());
        var refs = store.refsTo(cover);
        var attachments = media.attachmentsOfMedia(cover);
        jdbc.execute("ALTER TABLE cms_entry_index ADD CONSTRAINT injected_index_failure CHECK (value_string <> 'blocked')");
        assertThatThrownBy(() -> service.patch(null, Surface.BACK, before.id(), "changed-index",
                Map.of("title", "blocked"), before.version()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.findEntry(before.id())).contains(before);
        assertThat(store.indexRowsOf(before.id())).containsExactlyElementsOf(rows);
        assertThat(store.revisionsOf(before.id())).containsExactlyElementsOf(revisions);
        assertThat(store.refsTo(cover)).containsExactlyElementsOf(refs);
        assertThat(media.attachmentsOfMedia(cover)).containsExactlyElementsOf(attachments);
    }

    @Test
    void createAttachmentFailureRollsBackEntryAndRefs() {
        assertThatThrownBy(() -> service.create(null, Surface.BACK, type.typeKey(), "failed",
                Map.of("cover", UUID.randomUUID().toString())))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.countEntries(type.id(), true)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_entry_ref", Long.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_media_attachment", Long.class)).isZero();
    }

    @Test
    void patchAttachmentFailurePreservesEntryRefsAndPreviousAttachments() {
        UUID cover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", cover.toString()));
        EntryRecord before = store.findEntry(entry.id()).orElseThrow();
        var attachments = media.attachmentsOfMedia(cover);
        assertThatThrownBy(() -> service.patch(null, Surface.BACK, entry.id(), "changed",
                Map.of("cover", UUID.randomUUID().toString()), entry.version()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.findEntry(entry.id())).contains(before);
        assertThat(store.refsTo(cover)).containsExactly(new EntryRefRecord(entry.id(), "cover", cover, "media", 0));
        assertThat(media.attachmentsOfMedia(cover)).containsExactlyElementsOf(attachments);
    }

    @Test
    void publishRevisionFailureRollsBackStateAndVersion() {
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of());
        EntryRecord before = store.findEntry(entry.id()).orElseThrow();
        jdbc.execute("ALTER TABLE cms_entry_revision ADD CONSTRAINT injected_failure CHECK (revision_no < 0)");
        assertThatThrownBy(() -> service.publish(null, Surface.BACK, entry.id()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.findEntry(entry.id())).contains(before);
        assertThat(store.revisionsOf(entry.id())).isEmpty();
    }

    @Test
    void revertRebuildsWorkingRefsAndAttachmentsWithoutChangingPublishedSnapshot() {
        UUID originalCover = insertMedia();
        UUID nextCover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", originalCover.toString()));
        service.publish(null, Surface.BACK, entry.id());
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", nextCover.toString()), store.findEntry(entry.id()).orElseThrow().version());
        EntryRecord published = service.publish(null, Surface.BACK, entry.id());
        EntryRecord reverted = service.revert(null, Surface.BACK, entry.id(), 1);
        assertThat(reverted.version()).isEqualTo(published.version() + 1);
        assertThat(reverted.payload()).containsEntry("cover", originalCover.toString());
        assertThat(reverted.publishedPayload()).isEqualTo(published.publishedPayload());
        assertThat(store.refsTo(originalCover)).hasSize(1);
        assertThat(store.refsTo(nextCover)).isEmpty();
        assertThat(media.attachmentsOfMedia(originalCover)).hasSize(1);
        assertThat(media.attachmentsOfMedia(nextCover)).hasSize(1);
    }

    @Test
    void failedRevertRollsBackPayloadRefsAndAttachments() {
        UUID originalCover = insertMedia();
        UUID nextCover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", originalCover.toString()));
        service.publish(null, Surface.BACK, entry.id());
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", nextCover.toString()), store.findEntry(entry.id()).orElseThrow().version());
        EntryRecord before = store.findEntry(entry.id()).orElseThrow();
        jdbc.update("DELETE FROM cms_media WHERE id = ?", originalCover);
        assertThatThrownBy(() -> service.revert(null, Surface.BACK, entry.id(), 1))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.findEntry(entry.id())).contains(before);
        assertThat(store.refsTo(nextCover)).hasSize(1);
        assertThat(store.refsTo(originalCover)).isEmpty();
        assertThat(media.attachmentsOfMedia(nextCover)).hasSize(1);
    }

    @Test
    void statusWritesIncrementVersionAndPublishRemainsIdempotent() {
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of());
        assertThat(service.publish(null, Surface.BACK, entry.id()).version()).isEqualTo(2);
        assertThat(service.publish(null, Surface.BACK, entry.id()).version()).isEqualTo(2);
        assertThat(store.revisionsOf(entry.id())).hasSize(1);
        assertThat(service.unpublish(null, Surface.BACK, entry.id()).version()).isEqualTo(3);
        assertThat(service.archive(null, Surface.BACK, entry.id()).version()).isEqualTo(4);
        assertThat(service.restore(null, Surface.BACK, entry.id()).version()).isEqualTo(5);
        assertThatThrownBy(() -> service.patch(null, Surface.BACK, entry.id(), null, Map.of(), 1))
                .isInstanceOf(ContentException.class);
        assertThat(service.patch(null, Surface.BACK, entry.id(), null, Map.of(), store.findEntry(entry.id()).orElseThrow().version()).version()).isEqualTo(6);
        service.softDelete(null, Surface.BACK, entry.id());
        assertThat(store.findEntry(entry.id()).orElseThrow().version()).isEqualTo(7);
    }

    @Test
    void overlappingPublishAndPatchProduceOneVersionConflict() throws Exception {
        // Pause both after reading the same entry, before either can claim its version.
        var dataSource = PostgresFixture.cleanDataSource();
        var barrier = new CyclicBarrier(2);
        var racing = new AtomicBoolean(false);
        var racingStore = new JdbcContentStore(dataSource, new ObjectMapper()) {
            @Override
            public java.util.Optional<EntryRecord> findEntry(UUID id) {
                var entry = super.findEntry(id);
                if (racing.get()) {
                    try { barrier.await(10, TimeUnit.SECONDS); }
                    catch (Exception failure) { throw new IllegalStateException(failure); }
                }
                return entry;
            }
        };
        racingStore.insertType(type);
        var authorization = mock(AuthorizationService.class);
        var racingService = new EntryService(racingStore, authorization, identity,
                new MediaService(new JdbcMediaStore(dataSource), null, racingStore, authorization));
        EntryRecord original = racingService.create(null, Surface.BACK, type.typeKey(), "race", Map.of("title", "old"));
        racing.set(true);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var publish = executor.submit(() -> outcome(() -> racingService.publish(null, Surface.BACK, original.id())));
            var patch = executor.submit(() -> outcome(() -> racingService.patch(null, Surface.BACK, original.id(), null,
                    Map.of("title", "new"), original.version())));
            assertThat(List.of(publish.get(15, TimeUnit.SECONDS), patch.get(15, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder("ok", "conflict");
        }
        racing.set(false);
        EntryRecord saved = racingStore.findEntry(original.id()).orElseThrow();
        assertThat(saved.version()).isEqualTo(2);
        if (saved.publishedPayload() != null) {
            assertThat(saved.payload()).containsEntry("title", "old");
            assertThat(racingStore.revisionsOf(saved.id())).hasSize(1);
        } else {
            assertThat(saved.payload()).containsEntry("title", "new");
            assertThat(racingStore.revisionsOf(saved.id())).isEmpty();
        }
    }

    @Test
    void purgeAuditFailureRollsBackEntryDependentsAttachmentsAndAudit() {
        UUID cover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", cover.toString()));
        service.publish(null, Surface.BACK, entry.id());
        EntryRecord current = store.findEntry(entry.id()).orElseThrow();
        Principal admin = admin();
        doAnswer(call -> {
            // The audit really reaches the database before failure; it too must roll back.
            auditStore.insertAudit(call.getArgument(0));
            throw new IllegalStateException("audit failed");
        }).when(identity).insertAudit(any());
        assertThatThrownBy(() -> service.purge(admin, Surface.ADMIN, entry.id())).hasMessage("audit failed");
        assertThat(store.findEntry(entry.id())).contains(current);
        assertThat(store.revisionsOf(entry.id())).hasSize(1);
        assertThat(store.refsTo(cover)).hasSize(1);
        assertThat(media.attachmentsOfMedia(cover)).hasSize(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class)).isZero();
    }

    @Test
    void successfulPurgeRemovesDependentsAttachmentsAndPersistsAudit() {
        UUID cover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", cover.toString()));
        service.publish(null, Surface.BACK, entry.id());
        Principal admin = admin();
        doAnswer(call -> {
            auditStore.insertAudit(call.getArgument(0));
            return null;
        }).when(identity).insertAudit(any());
        service.purge(admin, Surface.ADMIN, entry.id());
        assertThat(store.findEntry(entry.id())).isEmpty();
        assertThat(store.revisionsOf(entry.id())).isEmpty();
        assertThat(store.refsTo(cover)).isEmpty();
        assertThat(media.attachmentsOfMedia(cover)).isEmpty();
        assertThat(auditStore.listAudits("entry.purge", entry.id())).hasSize(1);
    }

    @Test
    void draftMediaChangesAndRevertsStayPrivateUntilPublication() {
        UUID first = insertMedia();
        UUID second = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", first.toString()));
        service.publish(null, Surface.BACK, entry.id());
        assertThat(mediaService.publiclyReadable(first)).isTrue();
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", second.toString()), store.findEntry(entry.id()).orElseThrow().version());
        assertThat(mediaService.publiclyReadable(first)).isTrue();
        assertThat(mediaService.publiclyReadable(second)).isFalse();
        assertThat(media.attachmentsOfMedia(first)).hasSize(1);
        assertThat(media.attachmentsOfMedia(second)).hasSize(1);
        service.publish(null, Surface.BACK, entry.id());
        assertThat(mediaService.publiclyReadable(first)).isFalse();
        assertThat(mediaService.publiclyReadable(second)).isTrue();
        assertThat(media.attachmentsOfMedia(first)).isEmpty();
        service.revert(null, Surface.BACK, entry.id(), 1);
        assertThat(mediaService.publiclyReadable(first)).isFalse();
        assertThat(mediaService.publiclyReadable(second)).isTrue();
        service.publish(null, Surface.BACK, entry.id());
        assertThat(mediaService.publiclyReadable(first)).isTrue();
        assertThat(mediaService.publiclyReadable(second)).isFalse();
        // Identical working/published attachments are deduplicated.
        assertThat(media.attachmentsOfMedia(first)).hasSize(1);
        assertThat(media.attachmentsOfMedia(second)).isEmpty();
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", second.toString()), store.findEntry(entry.id()).orElseThrow().version());
        service.unpublish(null, Surface.BACK, entry.id());
        assertThat(media.attachmentsOfMedia(first)).isEmpty();
        assertThat(media.attachmentsOfMedia(second)).hasSize(1);
        assertThat(mediaService.publiclyReadable(first)).isFalse();
        assertThat(mediaService.publiclyReadable(second)).isFalse();
    }

    @Test
    void disabledTypeCannotExposeItsPublishedMedia() {
        UUID cover = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", cover.toString()));
        service.publish(null, Surface.BACK, entry.id());
        assertThat(mediaService.publiclyReadable(cover)).isTrue();
        store.updateType(new ContentTypeRecord(type.id(), type.typeKey(), type.displayName(), type.pluralDisplayName(),
                type.description(), type.titleField(), type.slugPolicy(), type.singleton(), false, type.previewable(),
                type.publicRequiresPublishedRefs(), type.createdAt(), Instant.now()));
        assertThat(mediaService.publiclyReadable(cover)).isFalse();
    }

    @Test
    void archiveKeepsOnlyWorkingMediaAttachments() {
        UUID first = insertMedia();
        UUID second = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", first.toString()));
        service.publish(null, Surface.BACK, entry.id());
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", second.toString()), store.findEntry(entry.id()).orElseThrow().version());
        service.archive(null, Surface.BACK, entry.id());
        assertThat(media.attachmentsOfMedia(first)).isEmpty();
        assertThat(media.attachmentsOfMedia(second)).hasSize(1);
        assertThat(mediaService.publiclyReadable(first)).isFalse();
        assertThat(mediaService.publiclyReadable(second)).isFalse();
        service.restore(null, Surface.BACK, entry.id());
        assertThat(media.attachmentsOfMedia(first)).isEmpty();
        assertThat(media.attachmentsOfMedia(second)).hasSize(1);
    }

    @Test
    void failedUnpublishRestoresPublishedStateAndBothAttachmentSets() {
        UUID first = insertMedia();
        UUID second = insertMedia();
        EntryRecord entry = service.create(null, Surface.BACK, type.typeKey(), "work", Map.of("cover", first.toString()));
        service.publish(null, Surface.BACK, entry.id());
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("cover", second.toString()), store.findEntry(entry.id()).orElseThrow().version());
        EntryRecord before = store.findEntry(entry.id()).orElseThrow();
        jdbc.execute("ALTER TABLE cms_media_attachment ADD CONSTRAINT injected_failure CHECK (field_key = 'never') NOT VALID");
        assertThatThrownBy(() -> service.unpublish(null, Surface.BACK, entry.id()))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(store.findEntry(entry.id())).contains(before);
        assertThat(media.attachmentsOfMedia(first)).hasSize(1);
        assertThat(media.attachmentsOfMedia(second)).hasSize(1);
        assertThat(mediaService.publiclyReadable(first)).isTrue();
        assertThat(mediaService.publiclyReadable(second)).isFalse();
    }

    @Test
    void legacyFractionalIntRemainsReadableButRejectedWritesLeaveAllDependentsUnchanged() {
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "rank", "int", false, false,
                true, "public", 0, null, "restrict", List.of(), true, false));
        UUID cover = insertMedia();
        EntryRecord legacy = ContentStoreContract.entry(type, "legacy", PublicationState.DRAFT,
                Map.of("rank", 1.5, "cover", cover.toString()), Instant.now());
        store.insertEntry(legacy);
        store.replaceRefs(legacy.id(), List.of(new EntryRefRecord(legacy.id(), "cover", cover, "media", 0)));
        mediaService.replaceAttachments(legacy.id(), List.of(new com.fallrising.cms.media.domain.MediaAttachment(
                cover, legacy.id(), "cover", Instant.now())));
        store.insertRevision(new com.fallrising.cms.content.domain.RevisionRecord(UUID.randomUUID(), legacy.id(), 1,
                legacy.slug(), legacy.payload(), Instant.now(), null, legacy.contentTypeKey()));
        var before = store.findEntry(legacy.id()).orElseThrow();
        var rows = store.indexRowsOf(legacy.id());
        var revisions = store.revisionsOf(legacy.id());
        var refs = store.refsTo(cover);
        var attachments = media.attachmentsOfMedia(cover);
        assertThat(service.getWork(null, Surface.BACK, legacy.id())).isEqualTo(before);
        assertThat(before.payload()).containsEntry("rank", 1.5);
        for (Runnable write : List.<Runnable>of(
                () -> service.patch(null, Surface.BACK, legacy.id(), "changed", Map.of("title", "changed"), before.version()),
                () -> service.publish(null, Surface.BACK, legacy.id()),
                () -> service.revert(null, Surface.BACK, legacy.id(), 1))) {
            assertThatThrownBy(write::run).isInstanceOfSatisfying(ContentException.class, failure -> {
                assertThat(failure.code()).isEqualTo(ErrorCode.FIELD_VALIDATION);
                assertThat(failure.fields()).singleElement().satisfies(field -> {
                    assertThat(field.field()).isEqualTo("payload.rank");
                    assertThat(field.code()).isEqualTo(FieldErrorCode.WRONG_TYPE);
                });
            });
            assertThat(store.findEntry(legacy.id())).contains(before);
            assertThat(store.indexRowsOf(legacy.id())).containsExactlyElementsOf(rows);
            assertThat(store.revisionsOf(legacy.id())).containsExactlyElementsOf(revisions);
            assertThat(store.refsTo(cover)).containsExactlyElementsOf(refs);
            assertThat(media.attachmentsOfMedia(cover)).containsExactlyElementsOf(attachments);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class)).isZero();
        }
        assertThat(service.patch(null, Surface.BACK, legacy.id(), null, Map.of("rank", 2), before.version()).payload())
                .containsEntry("rank", 2);
    }

    @Test
    void cleanLegacyPublicationRemainsReadOnlyNoOpUnderTighterValidation() {
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "rank", "int", false, false,
                true, "public", 0, null, "restrict", List.of(), true, false));
        EntryRecord legacy = ContentStoreContract.entry(type, "legacy-published", PublicationState.PUBLISHED,
                Map.of("rank", 1.5), Instant.now());
        store.insertEntry(legacy);
        EntryRecord before = store.findEntry(legacy.id()).orElseThrow();
        var rows = store.indexRowsOf(legacy.id());
        assertThat(service.publish(null, Surface.BACK, legacy.id())).isEqualTo(before);
        assertThat(store.findEntry(legacy.id())).contains(before);
        assertThat(store.indexRowsOf(legacy.id())).containsExactlyElementsOf(rows);
        assertThat(store.revisionsOf(legacy.id())).isEmpty();
    }

    private Principal admin() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        Principal admin = new Principal(id, "admin", "Admin", null, PrincipalStatus.ACTIVE, 0,
                null, null, now, now, null);
        auditStore.insertPrincipal(admin);
        when(identity.rolesOf(id)).thenReturn(List.of(new PrincipalRoleAssignment(id, UUID.randomUUID(), "admin", List.of())));
        return admin;
    }

    private UUID insertMedia() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        media.insert(new MediaAsset(id, UUID.randomUUID(), "cover", "", "cover.png", "image/png", 1, 1, 1, 1,
                "a".repeat(64), "available", null, now, now, List.of()));
        return id;
    }

    private static String outcome(java.util.function.Supplier<EntryRecord> operation) {
        try { operation.get(); return "ok"; }
        catch (ContentException conflict) {
            assertThat(conflict.getMessage()).isEqualTo("Entry version does not match");
            return "conflict";
        }
    }
}
