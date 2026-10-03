package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class ContentProjectionTests {
    @Test
    void nullMediaKeepsKeyWithoutCallingResolver() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("cover", null);
        AtomicInteger calls = new AtomicInteger();
        Map<String, Object> json = project(payload, raw -> {
            calls.incrementAndGet();
            throw new AssertionError("Null media must not be resolved");
        });
        assertThat(json).containsEntry("cover", null);
        assertThat(calls.get()).isZero();
    }

    @Test
    void unresolvedLegacyMediaNeverFallsBackToRawUuidOrObject() {
        for (Object raw : List.of(UUID.randomUUID().toString(), Map.of("mediaId", "malformed"))) {
            Map<String, Object> json = project(Map.of("cover", raw), value -> null);
            assertThat(json).containsEntry("cover", null);
        }
        Map<String, Object> expanded = Map.of("mediaId", UUID.randomUUID().toString());
        assertThat(project(Map.of("cover", expanded.get("mediaId")), raw -> expanded))
                .containsEntry("cover", expanded);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> project(Map<String, Object> payload,
            java.util.function.Function<Object, Object> resolver) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), "media", "Media", "Media", null,
                "title", "manual", false, true, false, List.of(), now, now);
        FieldRecord cover = new FieldRecord(UUID.randomUUID(), type.id(), "cover", "media-ref", false, false,
                false, "public", 0, null, "restrict", List.of(), true, false);
        EntryRecord entry = new EntryRecord(UUID.randomUUID(), type.id(), type.typeKey(), "media",
                PublicationState.PUBLISHED, 1, payload, payload, now, null, null, null, null, now, now);
        return (Map<String, Object>) ContentProjection.published(entry, type, List.of(cover), resolver).get("payload");
    }
}
