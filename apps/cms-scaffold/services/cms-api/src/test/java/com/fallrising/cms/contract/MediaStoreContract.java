package com.fallrising.cms.contract;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.store.MediaStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Behaviour every MediaStore must have (BD-10). */
public abstract class MediaStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected MediaStore store;

    protected abstract MediaStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_mediaRoundTripWithVariants() {
        MediaAsset asset = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(asset);
        MediaVariant original = variant(asset.id(), "original", "image/png", 100, 640, 480);
        MediaVariant thumb = variant(asset.id(), "thumbnail", "image/jpeg", 10, 320, 240);
        store.insertVariant(original);
        store.insertVariant(thumb);

        MediaAsset found = store.find(asset.id()).orElseThrow();
        assertThat(found).usingRecursiveComparison().ignoringFields("variants").isEqualTo(asset);
        assertThat(found.variants()).containsExactlyInAnyOrder(original, thumb);
        assertThat(store.variantsOf(asset.id())).containsExactlyInAnyOrder(original, thumb);
    }

    @Test
    void B08_unknownMediaIsEmpty() {
        assertThat(store.find(UUID.randomUUID())).isEmpty();
        assertThat(store.variantsOf(UUID.randomUUID())).isEmpty();
        assertThat(store.attachmentsOfMedia(UUID.randomUUID())).isEmpty();
    }

    @Test
    void B08_listAvailableExcludesDeletedNewestFirst() {
        UUID owner = UUID.randomUUID();
        MediaAsset older = asset(owner, "available", null, T0.plusSeconds(1));
        MediaAsset newer = asset(owner, "available", null, T0.plusSeconds(2));
        MediaAsset deleted = asset(owner, "deleted", T0.plusSeconds(4), T0.plusSeconds(3));
        MediaAsset inconsistent = asset(owner, "available", T0.plusSeconds(6), T0.plusSeconds(5));
        List.of(older, newer, deleted, inconsistent).forEach(store::insert);
        assertThat(store.listAvailable()).extracting(MediaAsset::id).containsExactly(newer.id(), older.id());
    }

    @Test
    void B08_updateChangesOnlyMutableColumns() {
        MediaAsset asset = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(asset);
        MediaAsset changed = new MediaAsset(asset.id(), UUID.randomUUID(), "New title", "New alt", "renamed.png",
                "application/pdf", 1, 999, 1, 1, "f".repeat(64), "deleted", T0.plusSeconds(9), T0.plusSeconds(8),
                T0.plusSeconds(9), List.of());
        store.update(changed);
        MediaAsset expected = new MediaAsset(asset.id(), asset.ownerPrincipalId(), "New title", "New alt",
                asset.originalFilename(), asset.contentType(), asset.byteSize(), 999, asset.width(), asset.height(),
                asset.checksumSha256(), "deleted", T0.plusSeconds(9), asset.createdAt(), T0.plusSeconds(9), List.of());
        assertThat(store.find(asset.id()).orElseThrow()).isEqualTo(expected);
    }

    @Test
    void B08_attachmentsReplacedPerEntry() {
        MediaAsset a = asset(UUID.randomUUID(), "available", null, T0);
        MediaAsset b = asset(UUID.randomUUID(), "available", null, T0);
        store.insert(a);
        store.insert(b);
        UUID entry1 = UUID.randomUUID();
        UUID entry2 = UUID.randomUUID();
        store.replaceAttachments(entry1, List.of(new MediaAttachment(a.id(), entry1, "cover", T0)));
        store.replaceAttachments(entry2, List.of(new MediaAttachment(a.id(), entry2, "media", T0)));
        assertThat(store.attachmentsOfMedia(a.id())).extracting(MediaAttachment::entryId)
                .containsExactlyInAnyOrder(entry1, entry2);

        store.replaceAttachments(entry1, List.of(new MediaAttachment(b.id(), entry1, "cover", T0)));
        assertThat(store.attachmentsOfMedia(a.id())).containsExactly(new MediaAttachment(a.id(), entry2, "media", T0));
        assertThat(store.attachmentsOfMedia(b.id())).containsExactly(new MediaAttachment(b.id(), entry1, "cover", T0));
    }

    @Test
    void B08_countsAndSumsIncludeDeleted() {
        UUID owner = UUID.randomUUID();
        store.insert(asset(owner, "available", null, T0));
        store.insert(asset(owner, "deleted", T0.plusSeconds(1), T0));
        store.insert(asset(UUID.randomUUID(), "available", null, T0));
        assertThat(store.countFiles()).isEqualTo(3);
        assertThat(store.sumStoredBytes()).isEqualTo(3 * 150L);
        assertThat(store.countByOwner(owner)).isEqualTo(2);
    }

    @Test
    void B08_defaultQuota() {
        assertThat(store.quota()).isEqualTo(new MediaStore.Quota(15_728_640L, 2_147_483_648L, 10_000, 2_000));
    }

    protected static MediaAsset asset(UUID owner, String status, Instant deletedAt, Instant createdAt) {
        return new MediaAsset(UUID.randomUUID(), owner, "Title", "Alt", "shot.png", "image/png", 100, 150, 640, 480,
                "a".repeat(64), status, deletedAt, createdAt, createdAt, List.of());
    }

    protected static MediaVariant variant(UUID mediaId, String name, String contentType, long bytes, Integer w, Integer h) {
        return new MediaVariant(mediaId, name, contentType, bytes, w, h, "media/" + mediaId + "/" + name);
    }
}
