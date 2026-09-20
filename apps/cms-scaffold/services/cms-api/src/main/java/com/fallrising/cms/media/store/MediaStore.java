package com.fallrising.cms.media.store;

import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MediaStore {

    void insert(MediaAsset asset);

    Optional<MediaAsset> find(UUID id);

    List<MediaAsset> listAvailable();

    void update(MediaAsset asset);

    void insertVariant(MediaVariant variant);

    List<MediaVariant> variantsOf(UUID mediaId);

    void replaceAttachments(UUID entryId, List<MediaAttachment> attachments);

    List<MediaAttachment> attachmentsOfMedia(UUID mediaId);

    long countFiles();

    long sumStoredBytes();

    long countByOwner(UUID ownerId);

    record Quota(long maxFileBytes, long maxLibraryBytes, int maxFiles, int maxFilesPerPrincipal) {}

    Quota quota();
}
