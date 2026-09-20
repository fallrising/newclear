package com.fallrising.cms.media.store;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class InMemoryMediaStore implements MediaStore {

    private final ConcurrentHashMap<UUID, MediaAsset> assets = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<MediaVariant>> variants = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<MediaAttachment>> attachmentsByEntry = new ConcurrentHashMap<>();

    @Override
    public void insert(MediaAsset asset) {
        assets.put(asset.id(), asset);
    }

    @Override
    public Optional<MediaAsset> find(UUID id) {
        MediaAsset asset = assets.get(id);
        if (asset == null) {
            return Optional.empty();
        }
        return Optional.of(withVariants(asset));
    }

    @Override
    public List<MediaAsset> listAvailable() {
        return assets.values().stream()
                .filter(MediaAsset::available)
                .sorted(Comparator.comparing(MediaAsset::createdAt).reversed())
                .map(this::withVariants)
                .toList();
    }

    @Override
    public void update(MediaAsset asset) {
        assets.put(asset.id(), asset);
    }

    @Override
    public void insertVariant(MediaVariant variant) {
        variants.computeIfAbsent(variant.mediaId(), ignored -> new CopyOnWriteArrayList<>()).add(variant);
    }

    @Override
    public List<MediaVariant> variantsOf(UUID mediaId) {
        return List.copyOf(variants.getOrDefault(mediaId, List.of()));
    }

    @Override
    public void replaceAttachments(UUID entryId, List<MediaAttachment> attachments) {
        attachmentsByEntry.put(entryId, new ArrayList<>(attachments));
    }

    @Override
    public List<MediaAttachment> attachmentsOfMedia(UUID mediaId) {
        return attachmentsByEntry.values().stream()
                .flatMap(List::stream)
                .filter(a -> a.mediaId().equals(mediaId))
                .toList();
    }

    @Override
    public long countFiles() {
        return assets.size();
    }

    @Override
    public long sumStoredBytes() {
        return assets.values().stream().mapToLong(MediaAsset::storedBytes).sum();
    }

    @Override
    public long countByOwner(UUID ownerId) {
        return assets.values().stream().filter(a -> ownerId.equals(a.ownerPrincipalId())).count();
    }

    @Override
    public Quota quota() {
        return new Quota(15_728_640, 2_147_483_648L, 10_000, 2_000);
    }

    private MediaAsset withVariants(MediaAsset asset) {
        return new MediaAsset(
                asset.id(),
                asset.ownerPrincipalId(),
                asset.title(),
                asset.altText(),
                asset.originalFilename(),
                asset.contentType(),
                asset.byteSize(),
                asset.storedBytes(),
                asset.width(),
                asset.height(),
                asset.checksumSha256(),
                asset.status(),
                asset.deletedAt(),
                asset.createdAt(),
                asset.updatedAt(),
                variantsOf(asset.id()));
    }
}
