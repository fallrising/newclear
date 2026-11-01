package com.fallrising.cms.media.service;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.MediaObjectStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verifyNoInteractions;

class MediaBatchTests {
    static final Instant NOW = Instant.parse("2026-10-04T00:00:00Z");

    @ParameterizedTest
    @ValueSource(strings = {"missing", "deleted-media", "unavailable-media", "detached", "draft-entry", "archived-entry",
            "deleted-entry", "private-entry", "disabled-type", "missing-type", "null-published", "stale-attachment",
            "missing-field", "disabled-field", "wrong-field-kind", "no-public-bytes", "required-missing", "required-draft",
            "required-deleted", "required-private", "required-malformed"})
    void unsafeMediaIsAbsentFromBatchAndNullFromExpander(String scenario) {
        Fixture fixture = new Fixture(scenario);
        UUID requested = scenario.equals("missing") ? UUID.randomUUID() : fixture.mediaId;
        Map<UUID, Map<String, Object>> result = fixture.service.resolvePublicAll(List.of(requested));
        assertThat(result).isEmpty();
        assertThat(fixture.service.publicExpander(List.of(requested)).apply(Map.of("mediaId", requested.toString()))).isNull();
        assertThat(fixture.service.resolvePublic(requested.toString())).isEmpty();
        assertThat(fixture.service.publiclyReadable(requested)).isFalse();
    }

    @Test
    void readableMediaPreservesPublicJsonDeduplicatesRawShapesAndResolvesExpanderOnce() {
        Fixture fixture = new Fixture("safe");
        List<Object> raw = List.of(fixture.mediaId, fixture.mediaId.toString(), Map.of("mediaId", fixture.mediaId.toString()), "invalid");
        Map<UUID, Map<String, Object>> resolved = fixture.service.resolvePublicAll(raw);
        assertThat(resolved).containsOnlyKeys(fixture.mediaId);
        Map<String, Object> json = resolved.get(fixture.mediaId);
        assertThat(json).containsEntry("mediaId", fixture.mediaId.toString()).containsEntry("altText", "Safe alt");
        assertThat(json.toString()).contains("/api/v1/public/media/" + fixture.mediaId + "/file/thumbnail")
                .doesNotContain("secret-object-key", "ownerPrincipalId");
        assertThat(fixture.service.resolvePublic(Map.of("mediaId", fixture.mediaId.toString()))).contains(json);
        var expander = fixture.service.publicExpander(raw);
        clearInvocations(fixture.content, fixture.media);
        assertThat(expander.apply(fixture.mediaId)).isEqualTo(json);
        assertThat(expander.apply(Map.of("mediaId", fixture.mediaId.toString()))).isEqualTo(json);
        assertThat(expander.apply("invalid")).isNull();
        verifyNoInteractions(fixture.content, fixture.media);
    }

    @Test
    void nullInvalidAndEmptyInputsDoNotReadStores() {
        Fixture fixture = new Fixture("safe");
        List<Object> raw = new ArrayList<>();
        raw.add(null);
        raw.add("invalid");
        raw.add(Map.of("mediaId", "invalid"));
        clearInvocations(fixture.content, fixture.media);
        assertThat(fixture.service.resolvePublicAll(raw)).isEmpty();
        assertThat(fixture.service.resolvePublicAll(List.of())).isEmpty();
        assertThat(fixture.service.publicExpander(raw).apply(null)).isNull();
        assertThat(fixture.service.resolvePublic(null)).isEmpty();
        verifyNoInteractions(fixture.content, fixture.media);
    }

    @Test
    void oneSafeAttachmentAllowsMediaEvenWhenAnotherAttachmentIsPrivate() {
        Fixture fixture = new Fixture("safe");
        UUID privateId = UUID.randomUUID();
        Map<String, Object> payload = Map.of("media", fixture.mediaId.toString(), "visibility", "private");
        fixture.content.insertEntry(fixture.entry(privateId, fixture.type, PublicationState.PUBLISHED, payload, payload, false));
        fixture.media.replaceAttachments(privateId, List.of(new MediaAttachment(fixture.mediaId, privateId, "media", NOW)));
        assertThat(fixture.service.resolvePublicAll(List.of(fixture.mediaId))).containsOnlyKeys(fixture.mediaId);
    }

    static final class Fixture {
        final InMemoryContentStore content = spy(new InMemoryContentStore());
        final InMemoryMediaStore media = spy(new InMemoryMediaStore());
        final UUID mediaId = UUID.randomUUID();
        final ContentTypeRecord type;
        final MediaService service;

        Fixture(String scenario) {
            type = type("batch_photo", !scenario.equals("disabled-type"), List.of("album"));
            ContentTypeRecord album = type("batch_album", true, List.of());
            content.insertType(type);
            content.insertType(album);
            if (!scenario.equals("missing-field")) {
                content.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "media",
                        scenario.equals("wrong-field-kind") ? "string" : "media-ref", false, false, false, "public", 0,
                        null, "restrict", List.of(), !scenario.equals("disabled-field"), !scenario.equals("no-public-bytes")));
            }
            MediaAsset asset = new MediaAsset(mediaId, UUID.randomUUID(), "Safe title", "Safe alt", "photo.png", "image/png",
                    100, 110, 8, 8, "a".repeat(64), scenario.equals("deleted-media") ? "deleted" : scenario.equals("unavailable-media") ? "processing" : "available",
                    scenario.equals("deleted-media") ? NOW : null, NOW, NOW, List.of());
            media.insert(asset);
            media.insertVariant(new MediaVariant(mediaId, "thumbnail", "image/jpeg", 10, 8, 8, "secret-object-key"));
            UUID albumId = UUID.randomUUID();
            if (!scenario.equals("required-missing")) {
                Map<String, Object> target = Map.of("visibility", scenario.equals("required-private") ? "private" : "public");
                content.insertEntry(entry(albumId, album, scenario.equals("required-draft") ? PublicationState.DRAFT : PublicationState.PUBLISHED,
                        target, target, scenario.equals("required-deleted")));
            }
            String ref = scenario.equals("required-malformed") ? "invalid" : albumId.toString();
            Map<String, Object> published = Map.of("media", scenario.equals("stale-attachment") ? UUID.randomUUID().toString() : mediaId.toString(),
                    "album", ref, "visibility", scenario.equals("private-entry") ? "private" : "public");
            UUID entryId = UUID.randomUUID();
            EntryRecord entry = entry(entryId, type, scenario.equals("draft-entry") ? PublicationState.DRAFT
                    : scenario.equals("archived-entry") ? PublicationState.ARCHIVED : PublicationState.PUBLISHED,
                    Map.of("media", mediaId.toString()), scenario.equals("null-published") ? null : published, scenario.equals("deleted-entry"));
            if (scenario.equals("missing-type")) entry = new EntryRecord(entry.id(), entry.contentTypeId(), "missing_type", entry.slug(),
                    entry.publicationState(), entry.version(), entry.payload(), entry.publishedPayload(), entry.publishedAt(), entry.archivedAt(),
                    entry.deletedAt(), entry.createdBy(), entry.updatedBy(), entry.createdAt(), entry.updatedAt());
            content.insertEntry(entry);
            if (!scenario.equals("detached")) media.replaceAttachments(entryId, List.of(new MediaAttachment(mediaId, entryId, "media", NOW)));
            service = new MediaService(media, mock(MediaObjectStore.class), content, mock(AuthorizationService.class));
        }

        private ContentTypeRecord type(String key, boolean enabled, List<String> required) {
            return new ContentTypeRecord(UUID.randomUUID(), key, key, key, null, "title", "none", false, enabled, false,
                    required, NOW, NOW, null, "visibility", null);
        }

        EntryRecord entry(UUID id, ContentTypeRecord type, PublicationState state, Map<String, Object> working,
                Map<String, Object> published, boolean deleted) {
            return new EntryRecord(id, type.id(), type.typeKey(), null, state, 1, working, published, NOW, null,
                    deleted ? NOW : null, null, null, NOW, NOW);
        }
    }
}
