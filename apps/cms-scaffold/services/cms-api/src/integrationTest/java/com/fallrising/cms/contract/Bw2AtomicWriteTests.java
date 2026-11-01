package com.fallrising.cms.contract;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.*;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.service.MediaService;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import javax.sql.DataSource;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** Real database regressions: an audit or later batch failure must undo every earlier dependent write. */
class Bw2AtomicWriteTests {
    DataSource dataSource;
    JdbcTemplate jdbc;
    JdbcContentStore store;
    JdbcMediaStore media;
    JdbcIdentityStore identity;
    AuthorizationService authorization;
    ObjectMapper mapper = new ObjectMapper();
    AtomicBoolean failAudit;
    AuditLog audit;
    EntryService service;
    ContentTypeRecord type;

    @BeforeEach void setUp() {
        dataSource = PostgresFixture.cleanDataSource();
        jdbc = new JdbcTemplate(dataSource);
        store = new JdbcContentStore(dataSource, mapper);
        media = new JdbcMediaStore(dataSource);
        identity = new JdbcIdentityStore(dataSource, null);
        authorization = mock(AuthorizationService.class);
        failAudit = new AtomicBoolean();
        audit = new AuditLog(identity, mapper) {
            @Override public void record(Principal actor, Surface surface, String category, String action,
                    String targetType, UUID targetId, String outcome, Map<String, Object> detail) {
                super.record(actor, surface, category, action, targetType, targetId, outcome, detail);
                if (failAudit.get()) throw new IllegalStateException("injected audit failure");
            }
        };
        service = service(store);
        type = ContentStoreContract.type("bw2_atomic");
        store.insertType(type);
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "title", "string", false, false,
                true, "public", 0, null, "restrict", List.of(), true, false));
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "cover", "media-ref", false, false,
                false, "public", 1, null, "restrict", List.of(), true, true));
        store.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "parent", "ref", false, false,
                true, "public", 2, type.typeKey(), "restrict", List.of(), true, false));
    }

    @Test void createAuditFailureRollsBackEntryIndexRefsMediaAndAudit() {
        UUID cover = media();
        EntryRecord parent = create("parent", Map.of("title", "parent"));
        long audits = audits();
        failAudit.set(true);
        assertThatThrownBy(() -> create("failed", Map.of("title", "failed", "parent", parent.id().toString(), "cover", cover.toString())))
                .hasMessage("injected audit failure");
        assertThat(store.countEntries(type.id(), true)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_entry_index", Long.class)).isEqualTo(store.indexRowsOf(parent.id()).size());
        assertThat(store.refsTo(parent.id())).isEmpty();
        assertThat(store.refsTo(cover)).isEmpty();
        assertThat(media.attachmentsOfMedia(cover)).isEmpty();
        assertThat(audits()).isEqualTo(audits);
    }

    @Test void publishAuditFailureRollsBackSnapshotVersionRevisionMediaAndAudit() {
        UUID first = media(); UUID second = media();
        EntryRecord entry = create("publish", Map.of("title", "old", "cover", first.toString()));
        service.publish(null, Surface.BACK, entry.id());
        service.patch(null, Surface.BACK, entry.id(), null, Map.of("title", "new", "cover", second.toString()), 2);
        service.requestPublish(null, Surface.BACK, entry.id());
        EntryRecord before = store.findEntry(entry.id()).orElseThrow();
        var rows = store.indexRowsOf(entry.id());
        var revisions = store.revisionsOf(entry.id());
        var firstAttachments = media.attachmentsOfMedia(first);
        var secondAttachments = media.attachmentsOfMedia(second);
        long audits = audits();
        failAudit.set(true);
        assertThatThrownBy(() -> service.publish(null, Surface.BACK, entry.id())).hasMessage("injected audit failure");
        assertThat(store.findEntry(entry.id())).contains(before);
        assertThat(store.indexRowsOf(entry.id())).containsExactlyElementsOf(rows);
        assertThat(store.revisionsOf(entry.id())).containsExactlyElementsOf(revisions);
        assertThat(media.attachmentsOfMedia(first)).containsExactlyElementsOf(firstAttachments);
        assertThat(media.attachmentsOfMedia(second)).containsExactlyElementsOf(secondAttachments);
        assertThat(audits()).isEqualTo(audits);
    }

    @Test void requestAndCancelAuditFailuresRollBackMetadataAndVersion() {
        EntryRecord entry = create("request", Map.of("title", "request"));
        failAudit.set(true);
        assertThatThrownBy(() -> service.requestPublish(null, Surface.BACK, entry.id())).hasMessage("injected audit failure");
        assertThat(store.findEntry(entry.id())).contains(entry);
        failAudit.set(false);
        service.requestPublish(null, Surface.BACK, entry.id());
        EntryRecord requested = store.findEntry(entry.id()).orElseThrow();
        long audits = audits();
        failAudit.set(true);
        assertThatThrownBy(() -> service.cancelPublishRequest(null, Surface.BACK, entry.id())).hasMessage("injected audit failure");
        assertThat(store.findEntry(entry.id())).contains(requested);
        assertThat(audits()).isEqualTo(audits);
    }

    @Test void repeatedRequestAndCancelReturnExactlyStableMetadataAndWriteOneAuditEach() {
        Instant now = Instant.now();
        Principal actor = new Principal(UUID.randomUUID(), "requester", "Requester", null, PrincipalStatus.ACTIVE, 0,
                null, null, now, now, null);
        identity.insertPrincipal(actor);
        EntryRecord entry = create("stable-request", Map.of("title", "stable"));
        EntryRecord requested = service.requestPublish(actor, Surface.BACK, entry.id());
        EntryRecord repeated = service.requestPublish(actor, Surface.BACK, entry.id());
        assertThat(repeated).isEqualTo(requested);
        assertThat(requested.version()).isEqualTo(2);
        assertThat(requested.publishRequestedBy()).isEqualTo(actor.id());
        assertThat(identity.listAudits("entry.publish_request", entry.id())).hasSize(1);
        EntryRecord cancelled = service.cancelPublishRequest(actor, Surface.BACK, entry.id());
        assertThat(service.cancelPublishRequest(actor, Surface.BACK, entry.id())).isEqualTo(cancelled);
        assertThat(cancelled.version()).isEqualTo(3);
        assertThat(cancelled.publishRequestedAt()).isNull();
        assertThat(cancelled.publishRequestedBy()).isNull();
        assertThat(identity.listAudits("entry.publish_request_cancel", entry.id())).hasSize(1);
    }

    @Test void secondBatchWriteFailureRollsBackAllEntriesIndexesRefsMediaAndVersions() {
        UUID oldCover = media(); UUID nextCover = media();
        EntryRecord parentA = create("parent-a", Map.of("title", "parent-a"));
        EntryRecord parentB = create("parent-b", Map.of("title", "parent-b"));
        EntryRecord a = create("a", Map.of("title", "old-a", "parent", parentA.id().toString(), "cover", oldCover.toString()));
        EntryRecord b = create("b", Map.of("title", "old-b", "parent", parentA.id().toString(), "cover", oldCover.toString()));
        var aRows = store.indexRowsOf(a.id()); var bRows = store.indexRowsOf(b.id());
        var parentRefs = store.refsTo(parentA.id()); var coverRefs = store.refsTo(oldCover);
        var oldAttachments = media.attachmentsOfMedia(oldCover);
        long audits = audits();
        jdbc.execute("ALTER TABLE cms_media_attachment ADD CONSTRAINT second_batch_write_failure CHECK (entry_id <> '" + b.id() + "'::uuid) NOT VALID");
        var patch = Map.<String,Object>of("title", "changed", "parent", parentB.id().toString(), "cover", nextCover.toString());
        assertThatThrownBy(() -> service.batchPatch(null, Surface.BACK, List.of(
                new EntryService.BatchItem(a.id(), a.version(), patch), new EntryService.BatchItem(b.id(), b.version(), patch))))
                .isInstanceOfSatisfying(ContentException.class, error -> {
                    assertThat(error.code()).isEqualTo(ErrorCode.INTERNAL_ERROR);
                    assertThat(error.getMessage()).isEqualTo("items[1]: Batch write failed");
                });
        assertThat(store.findEntry(a.id())).contains(a); assertThat(store.findEntry(b.id())).contains(b);
        assertThat(store.indexRowsOf(a.id())).containsExactlyElementsOf(aRows);
        assertThat(store.indexRowsOf(b.id())).containsExactlyElementsOf(bRows);
        assertThat(store.refsTo(parentA.id())).containsExactlyElementsOf(parentRefs);
        assertThat(store.refsTo(parentB.id())).isEmpty();
        assertThat(store.refsTo(oldCover)).containsExactlyElementsOf(coverRefs);
        assertThat(store.refsTo(nextCover)).isEmpty();
        assertThat(media.attachmentsOfMedia(oldCover)).containsExactlyElementsOf(oldAttachments);
        assertThat(media.attachmentsOfMedia(nextCover)).isEmpty();
        assertThat(audits()).isEqualTo(audits);
    }

    @Test void secondItemCasConflictRollsBackEarlierBatchWriteAndPreservesConcurrentWinner() throws Exception {
        EntryRecord a = create("race-a", Map.of("title", "old-a"));
        EntryRecord b = create("race-b", Map.of("title", "old-b"));
        var beforeRows = store.indexRowsOf(a.id());
        var reached = new CountDownLatch(1); var committed = new CountDownLatch(1);
        JdbcContentStore racing = new JdbcContentStore(dataSource, mapper) {
            @Override public EntryRecord updateEntry(EntryRecord entry) {
                if (entry.id().equals(b.id())) {
                    reached.countDown();
                    try { if (!committed.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("winner timeout"); }
                    catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                }
                return super.updateEntry(entry);
            }
        };
        try (var executor = Executors.newSingleThreadExecutor()) {
            var batch = executor.submit(() -> {
                try {
                    service(racing).batchPatch(null, Surface.BACK, List.of(
                            new EntryService.BatchItem(a.id(), 1, Map.of("title", "batch-a")),
                            new EntryService.BatchItem(b.id(), 1, Map.of("title", "batch-b"))));
                    return null;
                } catch (ContentException error) { return error; }
            });
            try {
                assertThat(reached.await(10, TimeUnit.SECONDS)).isTrue();
                service.patch(null, Surface.BACK, b.id(), null, Map.of("title", "winner"), 1);
            } finally { committed.countDown(); }
            var conflict = batch.get(15, TimeUnit.SECONDS);
            assertThat(conflict).isNotNull();
            assertThat(conflict.code()).isEqualTo(ErrorCode.VERSION_CONFLICT);
            assertThat(conflict.getMessage()).isEqualTo("items[1]: Entry version does not match");
        }
        assertThat(store.findEntry(a.id())).contains(a);
        assertThat(store.indexRowsOf(a.id())).containsExactlyElementsOf(beforeRows);
        var winner = store.findEntry(b.id()).orElseThrow();
        assertThat(winner.version()).isEqualTo(2); assertThat(winner.payload()).containsEntry("title", "winner");
    }

    private EntryService service(JdbcContentStore content) {
        return new EntryService(content, authorization, identity,
                new MediaService(media, null, content, authorization), audit);
    }
    private EntryRecord create(String slug, Map<String,Object> payload) {
        EntryRecord created = service.create(null, Surface.BACK, type.typeKey(), slug, payload);
        return store.findEntry(created.id()).orElseThrow();
    }
    private long audits() { return jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class); }
    private UUID media() {
        UUID id = UUID.randomUUID(); Instant now = Instant.now();
        media.insert(new MediaAsset(id, UUID.randomUUID(), "cover", "", "cover.png", "image/png", 1, 1, 1, 1,
                "a".repeat(64), "available", null, now, now, List.of()));
        return id;
    }
}
