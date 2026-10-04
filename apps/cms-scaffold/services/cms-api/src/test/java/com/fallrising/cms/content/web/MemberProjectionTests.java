package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class MemberProjectionTests {
    private final Instant now = Instant.parse("2026-10-04T00:00:00Z");
    private final ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), "owned", "Owned", "Owned entries", null,
            "title", "none", false, true, false, List.of(), now, now, null, null, "owner");

    @ParameterizedTest
    @ValueSource(strings = {"back", "internal", "disabled"})
    void titleCannotLeakAPrivateInternalOrDisabledField(String visibility) {
        Map<String, Object> result = ContentProjection.member(entry(Map.of("title", "Secret", "publicText", "Visible")), type,
                List.of(field("title", "string", visibility.equals("disabled") ? "public" : visibility, !visibility.equals("disabled")),
                        field("publicText", "string", "public", true)), value -> value);
        assertThat(result).containsEntry("title", null);
        assertThat(result.get("payload")).isEqualTo(Map.of("publicText", "Visible"));
        assertThat(result.toString()).doesNotContain("Secret");
    }

    @Test
    void projectsWorkingPublicValuesAndSafeMediaWithoutWorkMetadata() {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", "Working title");
        payload.put("media", "public-image");
        payload.put("missingMedia", "private-image");
        payload.put("nullValue", null);
        payload.put("privateMedia", "never-resolve");
        AtomicInteger calls = new AtomicInteger();
        Map<String, Object> result = ContentProjection.member(entry(payload), type,
                List.of(field("title", "string", "public", true), field("media", "media-ref", "public", true),
                        field("missingMedia", "media-ref", "public", true), field("nullValue", "string", "public", true),
                        field("privateMedia", "media-ref", "back", true)), raw -> {
                    calls.incrementAndGet();
                    return "public-image".equals(raw) ? Map.of("mediaId", "public-image") : null;
                });
        Map<String, Object> visible = new LinkedHashMap<>();
        visible.put("title", "Working title");
        visible.put("media", Map.of("mediaId", "public-image"));
        visible.put("missingMedia", null);
        visible.put("nullValue", null);
        assertThat(result).containsOnlyKeys("id", "contentType", "publicationState", "title", "payload", "createdAt", "updatedAt");
        assertThat(result).containsEntry("title", "Working title").containsEntry("payload", visible).containsEntry("publicationState", "draft");
        assertThat(calls.get()).isEqualTo(2);
        assertThat(result.toString()).doesNotContain("Published title", "never-resolve");
    }

    @Test
    void missingTitleAndMediaResolverYieldNullWithoutExposingRawMediaId() {
        Map<String, Object> result = ContentProjection.member(entry(Map.of("media", "private-image")), type,
                List.of(field("media", "media-ref", "public", true)), null);
        assertThat(result).containsEntry("title", null);
        assertThat(result.get("payload")).isEqualTo(java.util.Collections.singletonMap("media", null));
    }

    private FieldRecord field(String key, String kind, String visibility, boolean enabled) {
        return new FieldRecord(UUID.randomUUID(), type.id(), key, kind, false, false, false, visibility, 0, null,
                "restrict", List.of(), enabled, false);
    }

    private EntryRecord entry(Map<String, Object> payload) {
        return new EntryRecord(UUID.randomUUID(), type.id(), type.typeKey(), "hidden-slug", PublicationState.DRAFT, 7,
                payload, Map.of("title", "Published title"), now, null, null, UUID.randomUUID(), UUID.randomUUID(), now, now);
    }
}
