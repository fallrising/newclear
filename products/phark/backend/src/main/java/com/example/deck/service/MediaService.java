package com.example.deck.service;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.MediaContent;
import com.example.deck.model.StoredPostImage;
import com.example.deck.repository.PostImageRepository;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Metadata-first media read service. The only public handle is the positive
 * metadata row ID; callers never supply a path or storage key. Metadata is
 * looked up before any storage access, and bytes are served only after their
 * actual length and lowercase SHA-256 match the recorded metadata. Missing
 * metadata is a 404; missing, length-mismatched, or corrupted storage is an
 * {@link ApiErrorCode#INTERNAL_ERROR} that is fully logged server-side without
 * leaking the storage key, path, or SHA in the public detail.
 */
@Service
public class MediaService {

    private static final Logger LOGGER = LoggerFactory.getLogger(MediaService.class);

    private final PostImageRepository postImageRepository;
    private final MediaStorage mediaStorage;

    public MediaService(PostImageRepository postImageRepository, MediaStorage mediaStorage) {
        this.postImageRepository = postImageRepository;
        this.mediaStorage = mediaStorage;
    }

    public MediaContent read(long mediaId) {
        if (mediaId <= 0) {
            throw new ApiException(ApiErrorCode.INVALID_MEDIA_ID);
        }
        StoredPostImage metadata = postImageRepository
                .findPositiveId(mediaId)
                .orElseThrow(() -> new ApiException(ApiErrorCode.MEDIA_NOT_FOUND));

        byte[] bytes;
        try {
            bytes = mediaStorage.read(metadata.storageKey());
        } catch (RuntimeException failure) {
            LOGGER.error("Failed to read stored media for mediaId={}", mediaId, failure);
            throw new ApiException(ApiErrorCode.INTERNAL_ERROR, failure);
        }

        if (!matches(metadata, bytes)) {
            LOGGER.error("Stored media integrity check failed for mediaId={}", mediaId);
            throw new ApiException(
                    ApiErrorCode.INTERNAL_ERROR,
                    new IllegalStateException("Stored media failed the integrity check"));
        }
        return new MediaContent(metadata.id(), metadata.contentType(), bytes);
    }

    private boolean matches(StoredPostImage metadata, byte[] bytes) {
        if (bytes.length != metadata.byteSize()) {
            return false;
        }
        try {
            byte[] recorded = HexFormat.of().parseHex(metadata.sha256());
            return MessageDigest.isEqual(recorded, sha256(bytes));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 algorithm is unavailable", exception);
        }
    }
}