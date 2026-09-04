package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.deck.dto.CreatePostRequest;
import com.example.deck.model.Post;
import com.example.deck.model.PostImage;
import com.example.deck.model.ValidatedImage;
import com.example.deck.repository.PostRepository;
import java.awt.image.BufferedImage;
import java.awt.Color;
import java.awt.Graphics2D;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.web.multipart.MultipartFile;

class PostServiceMediaTest {

    private static final String KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";
    private static final String IP_HMAC = "a".repeat(64);

    private final PostRepository postRepository = mock(PostRepository.class);
    private final PostCursorCodec cursorCodec = mock(PostCursorCodec.class);
    private final ImageValidator imageValidator = new ImageValidator();
    private final MediaStorage mediaStorage = mock(MediaStorage.class);
    private final PostImagePersistenceService persistence = mock(PostImagePersistenceService.class);
    private final AbuseSignalRecorder signalRecorder = mock(AbuseSignalRecorder.class);
    private final PostService service =
            new PostService(
                    postRepository,
                    cursorCodec,
                    imageValidator,
                    mediaStorage,
                    persistence,
                    signalRecorder);

    @BeforeEach
    void setUp() {
        when(mediaStorage.store(any(), anyString())).thenReturn(KEY);
    }

    @Test
    void validImageValidatesThenStoresOneDefensiveCopyThenPersistsAndReturnsCommittedPost()
            throws Exception {
        byte[] jpeg = jpeg(1200, 800);
        MockMultipartFile image =
                new MockMultipartFile("image", "photo.jpg", "image/jpeg", jpeg);
        Post committed = postWithImage(42L);
        when(persistence.createOwnedWithImage(
                        eq(10L), eq("hello image"), eq("home"), eq(KEY),
                        any(ValidatedImage.class), eq(IP_HMAC)))
                .thenReturn(committed);

        Post result = service.createPostWithImage(
                10L, request(" hello image ", "home"), image, IP_HMAC);

        assertThat(result).isEqualTo(committed);
        assertThat(result.image()).isNotNull();
        verify(mediaStorage).store(eq(jpeg), eq("jpg"));
        ArgumentCaptor<ValidatedImage> captured = ArgumentCaptor.forClass(ValidatedImage.class);
        verify(persistence)
                .createOwnedWithImage(
                        eq(10L), eq("hello image"), eq("home"), eq(KEY),
                        captured.capture(), eq(IP_HMAC));
        ValidatedImage stored = captured.getValue();
        assertThat(stored.contentType()).isEqualTo("image/jpeg");
        assertThat(stored.extension()).isEqualTo("jpg");
        assertThat(stored.byteSize()).isEqualTo(jpeg.length);
        assertThat(stored.width()).isEqualTo(1200);
        assertThat(stored.height()).isEqualTo(800);
        assertThat(stored.sha256()).isEqualTo(sha256Hex(jpeg));

        InOrder order = inOrder(mediaStorage, persistence);
        order.verify(mediaStorage).store(eq(jpeg), eq("jpg"));
        order.verify(persistence)
                .createOwnedWithImage(
                        eq(10L), eq("hello image"), eq("home"), eq(KEY),
                        any(ValidatedImage.class), eq(IP_HMAC));
    }

    @Test
    void invalidImageFailsBeforeAnyStorageOrDatabaseWork() throws Exception {
        MockMultipartFile image =
                new MockMultipartFile("image", "photo.gif", "image/gif", jpeg(20, 20));

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isInstanceOf(InvalidImageException.class);

        verify(mediaStorage, never()).store(any(), anyString());
        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void oversizedImageFailsAsTooLargeWithoutAnyStorageOrDatabaseWork() {
        MockMultipartFile image = new MockMultipartFile(
                "image", "photo.jpg", "image/jpeg", new byte[5 * 1024 * 1024 + 1]);

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isInstanceOf(ImageTooLargeException.class);

        verify(mediaStorage, never()).store(any(), anyString());
        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void storageFailureLeavesNoDatabaseRowsAndRethrowsOriginal() throws Exception {
        MediaStorageException failure = new MediaStorageException("disk full");
        when(mediaStorage.store(any(), anyString())).thenThrow(failure);
        MockMultipartFile image =
                new MockMultipartFile("image", "photo.jpg", "image/jpeg", jpeg(20, 20));

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isSameAs(failure);

        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void persistenceFailureCompensatesByDeletingStoredMediaAndRethrowsOriginal() throws Exception {
        IllegalStateException failure = new IllegalStateException("commit failed");
        when(persistence.createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenThrow(failure);
        MockMultipartFile image =
                new MockMultipartFile("image", "photo.jpg", "image/jpeg", jpeg(20, 20));

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isSameAs(failure);

        verify(mediaStorage).delete(KEY);
    }

    @Test
    void cleanupFailureIsSuppressedAndNeverMasksPrimaryFailure() throws Exception {
        IllegalStateException primary = new IllegalStateException("commit failed");
        MediaStorageException cleanup = new MediaStorageException("delete failed");
        when(persistence.createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenThrow(primary);
        doThrow(cleanup).when(mediaStorage).delete(KEY);
        MockMultipartFile image =
                new MockMultipartFile("image", "photo.jpg", "image/jpeg", jpeg(20, 20));

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isSameAs(primary)
                .satisfies(exception -> assertThat(primary.getSuppressed()).containsExactly(cleanup));
    }

    @Test
    void multipartInputStreamFailureIsSafeAndDoesNoStorageOrDatabaseWork() throws Exception {
        MultipartFile image = mock(MultipartFile.class);
        when(image.getContentType()).thenReturn("image/jpeg");
        when(image.getInputStream()).thenThrow(new IOException("storage device gone"));

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isInstanceOf(InvalidImageException.class);

        verify(mediaStorage, never()).store(any(), anyString());
        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void successfulValidationClosesMultipartStreamBeforeStorageOrDatabaseWork() throws Exception {
        byte[] jpeg = jpeg(20, 20);
        AtomicBoolean closed = new AtomicBoolean(false);
        InputStream stream = new FilterInputStream(new ByteArrayInputStream(jpeg)) {
            @Override
            public void close() throws IOException {
                closed.set(true);
                super.close();
            }
        };
        MultipartFile image = new MockMultipartFile("image", "photo.jpg", "image/jpeg", new byte[0]) {
            @Override
            public InputStream getInputStream() {
                return stream;
            }
        };
        when(mediaStorage.store(any(), anyString()))
                .thenAnswer(invocation -> {
                    assertThat(closed)
                            .as("multipart stream must be closed before bytes are stored")
                            .isTrue();
                    return KEY;
                });
        when(persistence.createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString()))
                .thenReturn(postWithImage(1L));

        service.createPostWithImage(10L, request("hello image", "home"), image, IP_HMAC);

        assertThat(closed).isTrue();
        verify(persistence)
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void multipartCloseFailureIsSafeAndDoesNoStorageOrDatabaseWork() throws Exception {
        InputStream stream = new FilterInputStream(new ByteArrayInputStream(jpeg(20, 20))) {
            @Override
            public void close() throws IOException {
                throw new IOException("close failed");
            }
        };
        MultipartFile image = new MockMultipartFile("image", "photo.jpg", "image/jpeg", new byte[0]) {
            @Override
            public InputStream getInputStream() {
                return stream;
            }
        };

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isInstanceOf(InvalidImageException.class);

        verify(mediaStorage, never()).store(any(), anyString());
        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    @Test
    void multipartReadFailureIsSafeAndDoesNoStorageOrDatabaseWork() throws Exception {
        InputStream stream = new FilterInputStream(new ByteArrayInputStream(jpeg(20, 20))) {
            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                throw new IOException("read failed");
            }
        };
        MultipartFile image = new MockMultipartFile("image", "photo.jpg", "image/jpeg", new byte[0]) {
            @Override
            public InputStream getInputStream() {
                return stream;
            }
        };

        assertThatThrownBy(
                        () -> service.createPostWithImage(
                                10L, request("hello image", "home"), image, IP_HMAC))
                .isInstanceOf(InvalidImageException.class);

        verify(mediaStorage, never()).store(any(), anyString());
        verify(persistence, never())
                .createOwnedWithImage(
                        anyLong(), anyString(), anyString(), anyString(), any(), anyString());
    }

    private static Post postWithImage(long postId) {
        return new Post(
                postId,
                "Alice",
                "alice_ops",
                "hello image",
                "home",
                Instant.parse("2026-09-03T10:00:00Z"),
                0L,
                0L,
                false,
                "post:" + postId,
                0L,
                false,
                null,
                null,
                null,
                PostImage.of(7L, "image/jpeg", 1200, 800, 12345));
    }

    private static CreatePostRequest request(String content, String channel) {
        return new CreatePostRequest(content, channel);
    }

    private static byte[] jpeg(int width, int height) throws Exception {
        BufferedImage image =
                new BufferedImage(width, height, BufferedImage.TYPE_3BYTE_BGR);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "jpg", out)) {
            throw new IllegalStateException("No JPEG writer available");
        }
        return out.toByteArray();
    }

    private static String sha256Hex(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }
}
