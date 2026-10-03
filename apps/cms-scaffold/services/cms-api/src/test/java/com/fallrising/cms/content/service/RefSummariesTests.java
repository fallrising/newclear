package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.*;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.identity.domain.*;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.media.service.MediaService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RefSummariesTests {
    Instant now = Instant.parse("2026-01-01T00:00:00Z");
    InMemoryContentStore store;
    EntryService service;
    ContentTypeRecord type;
    FieldRecord ref;

    @BeforeEach void setUp() {
        store = spy(new InMemoryContentStore());
        type = new ContentTypeRecord(UUID.randomUUID(), "album", "Album", "Albums", null, "title", "optional",
                false, true, true, List.of(), now, now);
        store.insertType(type);
        ref = field("album", "ref", true);
        var identity = mock(IdentityStore.class);
        var role = new Role(UUID.randomUUID(), "anonymous", "Anonymous", true, now);
        when(identity.findRoleByCode("anonymous")).thenReturn(Optional.of(role));
        when(identity.permissionsOfRole(role.id())).thenReturn(List.of(new Permission(UUID.randomUUID(), role.id(), "read_draft", "album",
                "{\"type\":\"fieldEquals\",\"field\":\"audience\",\"value\":\"mine\"}", List.of("back"), now)));
        var authorization = new AuthorizationService(identity, new ObjectMapper());
        service = new EntryService(store, authorization, identity, mock(MediaService.class), mock(AuditLog.class));
        clearInvocations(store);
    }

    @Test void predicatesUseTargetWorkingPayloadAndRestrictedSummariesLeakNoMetadata() {
        EntryRecord allowed = entry(Map.of("title", "Working title", "audience", "mine"), Map.of("title", "Published title", "audience", "other"), null);
        EntryRecord denied = entry(Map.of("title", "Secret working title", "audience", "other"), Map.of("title", "Public title", "audience", "mine"), null);
        store.insertEntry(allowed); store.insertEntry(denied);
        EntryRecord a = entry(Map.of("album", allowed.id().toString(), "audience", "other"), null, null);
        EntryRecord b = entry(Map.of("album", denied.id().toString(), "audience", "mine"), null, null);
        var summaries = service.refSummaries(null, Surface.BACK, List.of(a, b), List.of(ref));
        assertThat(summaries.get(a.id())).containsEntry("album", Map.of("id", allowed.id().toString(), "contentType", "album",
                "title", "Working title", "publicationState", "published"));
        assertThat(summaries.get(b.id())).containsEntry("album", Map.of("id", denied.id().toString(), "restricted", true));
    }

    @Test void missingAndSoftDeletedSummariesLeakNoMetadata() {
        EntryRecord deleted = entry(Map.of("title", "Secret deleted title", "audience", "mine"), null, now);
        store.insertEntry(deleted);
        UUID absent = UUID.randomUUID();
        EntryRecord a = entry(Map.of("album", absent.toString()), null, null);
        EntryRecord b = entry(Map.of("album", deleted.id().toString()), null, null);
        var summaries = service.refSummaries(null, Surface.BACK, List.of(a, b), List.of(ref));
        assertThat(summaries.get(a.id())).containsEntry("album", Map.of("id", absent.toString(), "missing", true));
        assertThat(summaries.get(b.id())).containsEntry("album", Map.of("id", deleted.id().toString(), "missing", true));
    }

    @Test void onePageReadsDistinctTargetsOnceRegardlessOfEntryCount() {
        EntryRecord target = entry(Map.of("title", "Target", "audience", "mine"), null, null);
        store.insertEntry(target);
        List<EntryRecord> page = new ArrayList<>();
        for (int i = 0; i < 100; i++) page.add(entry(Map.of("album", target.id().toString()), null, null));
        clearInvocations(store);
        assertThat(service.refSummaries(null, Surface.BACK, page, List.of(ref))).hasSize(100);
        verify(store, times(1)).findEntries(argThat(ids -> ids.size() == 1 && ids.contains(target.id())));
        verify(store, times(1)).listTypes();
        verify(store, never()).findEntry(any());
    }

    @Test void disabledMediaPrincipalAndNonCanonicalRefsDoNotReadTargets() {
        var payload = Map.<String,Object>of("disabled", UUID.randomUUID().toString(), "media", UUID.randomUUID().toString(),
                "principal", UUID.randomUUID().toString(), "album", "ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB");
        EntryRecord source = entry(payload, null, null);
        var fields = List.of(ref, field("disabled", "ref", false), field("media", "media-ref", true), field("principal", "principal-ref", true));
        assertThat(service.refSummaries(null, Surface.BACK, List.of(source), fields).get(source.id())).isEmpty();
        verify(store, never()).findEntries(any());
        verify(store, never()).listTypes();
        verify(store, never()).findEntry(any());
    }

    private FieldRecord field(String key, String kind, boolean enabled) {
        return new FieldRecord(UUID.randomUUID(), type.id(), key, kind, false, false, false, "public", 0,
                null, "restrict", List.of(), enabled, false);
    }
    private EntryRecord entry(Map<String,Object> payload, Map<String,Object> published, Instant deleted) {
        return new EntryRecord(UUID.randomUUID(), type.id(), type.typeKey(), null, published == null ? PublicationState.DRAFT : PublicationState.PUBLISHED,
                1, payload, published, published == null ? null : now, null, deleted, null, null, now, now);
    }
}
