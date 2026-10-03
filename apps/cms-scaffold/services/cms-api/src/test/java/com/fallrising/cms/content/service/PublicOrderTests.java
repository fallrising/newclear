package com.fallrising.cms.content.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.PublicationState;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PublicOrderTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    static ContentTypeRecord type(String sortField) {
        return new ContentTypeRecord(UUID.randomUUID(), "photo", "Photo", "Photos", null, "title", "optional", false,
                true, true, List.of(), T0, T0, sortField, null, null);
    }

    static EntryRecord entry(String slug, Map<String, Object> payload, int publishedAt, int updatedAt) {
        return new EntryRecord(UUID.randomUUID(), UUID.randomUUID(), "photo", slug, PublicationState.PUBLISHED, 1,
                payload, payload, T0.plusSeconds(publishedAt), null, null, null, null, T0, T0.plusSeconds(updatedAt));
    }

    @Test
    void B03_sortFieldAscendingThenNewestUpdate() {
        List<EntryRecord> entries = List.of(
                entry("b", Map.of("rank", 2), 1, 1),
                entry("fraction", Map.of("rank", 1.5), 1, 1),
                entry("none", Map.of(), 1, 9),
                entry("a2", Map.of("rank", 1), 1, 1),
                entry("a1", Map.of("rank", 1), 1, 5),
                entry("text", Map.of("rank", "1"), 1, 8));
        assertThat(entries.stream().sorted(EntryService.publicOrder(type("rank"))).map(EntryRecord::slug))
                .containsExactly("a1", "a2", "fraction", "b", "none", "text");
    }

    @Test
    void B03_withoutSortFieldNewestPublishFirst() {
        List<EntryRecord> entries = List.of(
                entry("old", Map.of("sortOrder", 1), 1, 50),
                entry("new", Map.of("sortOrder", 9), 3, 3),
                entry("mid", Map.of(), 2, 2));
        assertThat(entries.stream().sorted(EntryService.publicOrder(type(null))).map(EntryRecord::slug))
                .containsExactly("new", "mid", "old");
    }

    @Test
    void B03_publicTimestampTiesUseUpdateAndNullTimestampsComeLast() {
        EntryRecord missingPublish = new EntryRecord(UUID.randomUUID(), UUID.randomUUID(), "photo", "missing",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), null, null, null, null, null, T0, T0.plusSeconds(90));
        EntryRecord missingUpdate = new EntryRecord(UUID.randomUUID(), UUID.randomUUID(), "photo", "no-update",
                PublicationState.PUBLISHED, 1, Map.of(), Map.of(), T0.plusSeconds(3), null, null, null, null, T0, null);
        List<EntryRecord> entries = List.of(missingPublish, entry("older-update", Map.of(), 3, 4), missingUpdate,
                entry("newer-update", Map.of(), 3, 8));
        assertThat(entries.stream().sorted(EntryService.publicOrder(type(null))).map(EntryRecord::slug))
                .containsExactly("newer-update", "older-update", "no-update", "missing");
    }
}
