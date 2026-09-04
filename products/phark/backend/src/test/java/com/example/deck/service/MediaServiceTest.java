package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.MediaContent;
import com.example.deck.model.StoredPostImage;
import com.example.deck.repository.PostImageRepository;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MediaServiceTest {

    private static final String STORAGE_KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    private static final String INTERNAL_PATH = "/data/media/" + STORAGE_KEY;

    @Mock
    private PostImageRepository postImageRepository;

    @Mock
    private MediaStorage mediaStorage;

    @InjectMocks
    private MediaService mediaService;

    @ParameterizedTest
    @ValueSource(longs = {0, -1, -42})
    void readRejectsNonPositiveIdsBeforeRepositoryAndStorageAccess(long mediaId) {
        assertThatThrownBy(() -> mediaService.read(mediaId))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception ->
                                assertThat(exception.getCode())
                                        .isEqualTo(ApiErrorCode.INVALID_MEDIA_ID));

        verifyNoInteractions(postImageRepository, mediaStorage);
    }

    @Test
    void readMissingMetadataThrowsMediaNotFoundWithoutTouchingStorage() {
        when(postImageRepository.findPositiveId(42L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> mediaService.read(42L))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception ->
                                assertThat(exception.getCode())
                                        .isEqualTo(ApiErrorCode.MEDIA_NOT_FOUND));

        verifyNoInteractions(mediaStorage);
    }

    @Test
    void readReturnsExactBytesWithPublicIdAndCanonicalTypeInMetadataFirstOrder() {
        byte[] bytes = new byte[] {1, 2, 3, 4, 5};
        when(postImageRepository.findPositiveId(7L))
                .thenReturn(Optional.of(metadata(7L, bytes)));
        when(mediaStorage.read(STORAGE_KEY)).thenReturn(bytes);

        MediaContent content = mediaService.read(7L);

        assertThat(content.id()).isEqualTo(7L);
        assertThat(content.contentType()).isEqualTo("image/jpeg");
        assertThat(content.bytes()).isEqualTo(bytes);

        InOrder order = inOrder(postImageRepository, mediaStorage);
        order.verify(postImageRepository).findPositiveId(7L);
        order.verify(mediaStorage).read(STORAGE_KEY);
    }

    @Test
    void mediaContentDefensivelyCopiesBytesOnConstructionAndAccess() {
        byte[] source = new byte[] {1, 2, 3};
        MediaContent content = new MediaContent(7L, "image/jpeg", source);

        source[0] = 99;
        assertThat(content.bytes()).containsExactly(1, 2, 3);

        byte[] handedOut = content.bytes();
        handedOut[0] = 99;
        assertThat(content.bytes()).containsExactly(1, 2, 3);
    }

    @Test
    void readStorageFailureThrowsInternalErrorWithCauseAndNoInternalDetail() {
        byte[] bytes = new byte[] {1, 2, 3};
        when(postImageRepository.findPositiveId(7L))
                .thenReturn(Optional.of(metadata(7L, bytes)));
        when(mediaStorage.read(STORAGE_KEY))
                .thenThrow(new MediaStorageException("Failed to read " + INTERNAL_PATH));

        assertThatThrownBy(() -> mediaService.read(7L))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception -> {
                            assertThat(exception.getCode()).isEqualTo(ApiErrorCode.INTERNAL_ERROR);
                            assertThat(exception.getCause())
                                    .isInstanceOf(MediaStorageException.class);
                            assertThat(exception.getDetail())
                                    .doesNotContain(STORAGE_KEY)
                                    .doesNotContain(INTERNAL_PATH)
                                    .doesNotContain(sha256(bytes));
                        });
    }

    @Test
    void readByteLengthMismatchThrowsInternalErrorWithoutInternalDetail() {
        byte[] expected = new byte[] {1, 2, 3, 4};
        byte[] truncated = new byte[] {1, 2, 3};
        when(postImageRepository.findPositiveId(7L))
                .thenReturn(Optional.of(metadata(7L, expected)));
        when(mediaStorage.read(STORAGE_KEY)).thenReturn(truncated);

        assertThatThrownBy(() -> mediaService.read(7L))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception -> {
                            assertThat(exception.getCode()).isEqualTo(ApiErrorCode.INTERNAL_ERROR);
                            assertThat(exception.getDetail())
                                    .doesNotContain(STORAGE_KEY)
                                    .doesNotContain(INTERNAL_PATH)
                                    .doesNotContain(sha256(expected));
                        });
    }

    @Test
    void readShaMismatchThrowsInternalErrorWithoutInternalDetail() {
        byte[] bytes = new byte[] {1, 2, 3};
        StoredPostImage metadata = new StoredPostImage(
                7L,
                100L,
                STORAGE_KEY,
                "image/png",
                bytes.length,
                1200,
                800,
                "0".repeat(64),
                Instant.EPOCH);
        when(postImageRepository.findPositiveId(7L)).thenReturn(Optional.of(metadata));
        when(mediaStorage.read(STORAGE_KEY)).thenReturn(bytes);

        assertThatThrownBy(() -> mediaService.read(7L))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        exception -> {
                            assertThat(exception.getCode()).isEqualTo(ApiErrorCode.INTERNAL_ERROR);
                            assertThat(exception.getDetail())
                                    .doesNotContain(STORAGE_KEY)
                                    .doesNotContain(INTERNAL_PATH)
                                    .doesNotContain("0".repeat(64))
                                    .doesNotContain(sha256(bytes));
                        });
    }

    private static StoredPostImage metadata(long id, byte[] bytes) {
        return new StoredPostImage(
                id,
                100L,
                STORAGE_KEY,
                "image/jpeg",
                bytes.length,
                1200,
                800,
                sha256(bytes),
                Instant.EPOCH);
    }

    private static String sha256(byte[] data) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }
}