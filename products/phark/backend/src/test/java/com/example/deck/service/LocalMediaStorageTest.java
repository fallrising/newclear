package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class LocalMediaStorageTest {

    private static final String KEY_GRAMMAR =
            "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png)";

    @TempDir
    Path tempDir;

    @Test
    void storeRoundTripsExactBytesAndDeletesIdempotently() throws IOException {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);
        byte[] bytes = "image bytes".getBytes(StandardCharsets.UTF_8);

        String key = storage.store(bytes, "png");

        assertThat(key).matches(KEY_GRAMMAR);
        assertThat(Files.readAllBytes(tempDir.resolve(key))).isEqualTo(bytes);
        assertThat(storage.read(key)).isEqualTo(bytes);

        storage.delete(key);
        assertThat(Files.exists(tempDir.resolve(key))).isFalse();
        storage.delete(key);
    }

    @Test
    void storeGeneratesLowercaseUuidV4KeyWithValidatedExtension() {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        String key = storage.store(new byte[] {1, 2, 3}, "jpg");

        assertThat(key).matches(KEY_GRAMMAR);
        assertThat(key).isEqualTo(key.toLowerCase());
        assertThat(key).endsWith(".jpg");
    }

    @ParameterizedTest
    @ValueSource(strings = {"jpeg", "gif", "webp", "png ", "PNG", "jpg.png"})
    void storeRejectsUnsupportedExtension(String extension) throws IOException {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        assertThatThrownBy(() -> storage.store(new byte[] {1}, extension))
                .isInstanceOf(MediaStorageException.class);
        assertThat(keyCount()).isZero();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "../escape.png",
                "a/b.png",
                "abc/../../escape.png",
                "/etc/passwd.png",
                "..\\escape.png",
                "00000000-0000-4000-8000-000000000000.jpeg",
                "00000000-0000-3000-8000-000000000000.png",
                "00000000-0000-4000-7000-000000000000.jpg",
                "ABCDEF00-abcd-4def-8abc-000000000000.png",
                "00000000-0000-4000-8000-000000000000",
            })
    void readAndDeleteRejectKeysOutsideGrammar(String storageKey) {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        assertThatThrownBy(() -> storage.read(storageKey))
                .isInstanceOf(MediaStorageException.class);
        assertThatThrownBy(() -> storage.delete(storageKey))
                .isInstanceOf(MediaStorageException.class);
    }

    @Test
    void readMissingKeyFailsSafely() {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        assertThatThrownBy(() -> storage.read("00000000-0000-4000-8000-000000000000.jpg"))
                .isInstanceOf(MediaStorageException.class);
    }

    @Test
    void deleteMissingKeyIsIdempotent() {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        storage.delete("00000000-0000-4000-8000-000000000000.jpg");
    }

    @Test
    void readOnUnreadablePathFailsSafely() throws IOException {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);
        Files.createDirectory(tempDir.resolve("00000000-0000-4000-8000-000000000000.jpg"));

        assertThatThrownBy(() -> storage.read("00000000-0000-4000-8000-000000000000.jpg"))
                .isInstanceOf(MediaStorageException.class);
    }

    @Test
    void symlinkMediaRootIsRejected() throws IOException {
        Path real = Files.createDirectory(tempDir.resolve("real"));
        Path link = Files.createSymbolicLink(tempDir.resolve("link"), real);

        assertThatThrownBy(() -> new LocalMediaStorage(link))
                .isInstanceOf(MediaStorageException.class);
    }

    @Test
    void readAndDeleteRejectSymlinkFinalTarget() throws IOException {
        Path targetRoot = Files.createDirectory(tempDir.resolve("target"));
        LocalMediaStorage storage = new LocalMediaStorage(targetRoot);
        String key = storage.store("secret".getBytes(StandardCharsets.UTF_8), "jpg");
        Path stored = targetRoot.resolve(key);
        Files.delete(stored);

        Path outside = tempDir.resolve("outside.txt");
        Files.writeString(outside, "outside sensitive bytes");
        Files.createSymbolicLink(stored, outside);

        assertThatThrownBy(() -> storage.read(key)).isInstanceOf(MediaStorageException.class);
        assertThatThrownBy(() -> storage.delete(key)).isInstanceOf(MediaStorageException.class);
        assertThat(Files.readString(outside)).isEqualTo("outside sensitive bytes");
    }

    @Test
    void storeLeavesNoTempFilesBehind() throws IOException {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);

        storage.store(new byte[] {1, 2, 3}, "jpg");

        assertThat(keyCount()).isEqualTo(1);
    }

    @Test
    void constructRootReachedThroughSymlinkedAncestorIsRejected() throws IOException {
        Path realBase = Files.createDirectory(tempDir.resolve("realbase"));
        Path alias = Files.createSymbolicLink(tempDir.resolve("alias"), realBase);
        Path root = alias.resolve("media");
        Files.createDirectories(root);

        assertThatThrownBy(() -> new LocalMediaStorage(root))
                .isInstanceOf(MediaStorageException.class);
    }

    @Test
    void storeRejectsRootSwappedToSymlinkAfterConstruction() throws IOException {
        Path root = Files.createDirectory(tempDir.resolve("root"));
        LocalMediaStorage storage = new LocalMediaStorage(root);
        Path outside = Files.createDirectory(tempDir.resolve("outside"));

        Files.delete(root);
        Files.createSymbolicLink(root, outside);

        assertThatThrownBy(() -> storage.store(new byte[] {1, 2, 3}, "jpg"))
                .isInstanceOf(MediaStorageException.class);
        assertThat(keyCountIn(outside)).isZero();
    }

    @Test
    void readAndDeleteRejectRootSwappedToSymlinkAfterConstruction() throws IOException {
        Path root = Files.createDirectory(tempDir.resolve("root"));
        LocalMediaStorage storage = new LocalMediaStorage(root);
        String key = storage.store(new byte[] {1}, "jpg");
        Files.delete(root.resolve(key));
        Path outside = Files.createDirectory(tempDir.resolve("outside"));

        Files.delete(root);
        Files.createSymbolicLink(root, outside);

        assertThatThrownBy(() -> storage.read(key)).isInstanceOf(MediaStorageException.class);
        assertThatThrownBy(() -> storage.delete(key)).isInstanceOf(MediaStorageException.class);
    }

    @Test
    void storeRejectsCollisionWithExistingFinalFile() throws IOException {
        Path root = Files.createDirectory(tempDir.resolve("root"));
        String fixedUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        LocalMediaStorage storage = deterministicStorage(root, fixedUuid);
        Path target = root.resolve(fixedUuid + ".jpg");
        byte[] existing = "pre-existing bytes".getBytes(StandardCharsets.UTF_8);
        Files.write(target, existing);

        assertThatThrownBy(() -> storage.store(new byte[] {1, 2, 3}, "jpg"))
                .isInstanceOf(MediaStorageException.class);
        assertThat(Files.readAllBytes(target)).isEqualTo(existing);
    }

    @Test
    void storeRejectsCollisionWithSymlinkFinalTarget() throws IOException {
        Path root = Files.createDirectory(tempDir.resolve("root"));
        String fixedUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        LocalMediaStorage storage = deterministicStorage(root, fixedUuid);
        Path outside = tempDir.resolve("outside.txt");
        Files.writeString(outside, "outside sensitive bytes");
        Files.createSymbolicLink(root.resolve(fixedUuid + ".jpg"), outside);

        assertThatThrownBy(() -> storage.store(new byte[] {1, 2, 3}, "jpg"))
                .isInstanceOf(MediaStorageException.class);
        assertThat(Files.readString(outside)).isEqualTo("outside sensitive bytes");
    }

    @Test
    void storeFailsSafelyAndWrapsWhenRootBecomesUnavailable() throws IOException {
        LocalMediaStorage storage = new LocalMediaStorage(tempDir);
        Files.delete(tempDir);

        assertThatThrownBy(() -> storage.store(new byte[] {1}, "jpg"))
                .isInstanceOf(MediaStorageException.class);
    }

    private LocalMediaStorage deterministicStorage(Path root, String uuid) {
        return new LocalMediaStorage(root, () -> UUID.fromString(uuid));
    }

    private long keyCountIn(Path directory) {
        try (var files = Files.list(directory)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.matches(KEY_GRAMMAR))
                    .count();
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private long keyCount() {
        try (var files = Files.list(tempDir)) {
            return files.map(path -> path.getFileName().toString())
                    .filter(name -> name.matches(KEY_GRAMMAR))
                    .count();
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }
}