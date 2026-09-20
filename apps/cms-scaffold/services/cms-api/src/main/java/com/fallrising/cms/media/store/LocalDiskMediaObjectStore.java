package com.fallrising.cms.media.store;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public class LocalDiskMediaObjectStore implements MediaObjectStore {

    private final Path root;

    public LocalDiskMediaObjectStore(Path root) {
        this.root = root.toAbsolutePath().normalize();
    }

    @Override
    public void put(String objectKey, byte[] bytes) {
        Path path = resolve(objectKey);
        try {
            Files.createDirectories(path.getParent());
            Files.write(path, bytes);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to write media object", e);
        }
    }

    @Override
    public Optional<byte[]> get(String objectKey) {
        Path path = resolve(objectKey);
        if (!Files.isRegularFile(path)) {
            return Optional.empty();
        }
        try {
            return Optional.of(Files.readAllBytes(path));
        } catch (IOException e) {
            throw new IllegalStateException("Unable to read media object", e);
        }
    }

    @Override
    public void delete(String objectKey) {
        try {
            Files.deleteIfExists(resolve(objectKey));
        } catch (IOException e) {
            throw new IllegalStateException("Unable to delete media object", e);
        }
    }

    private Path resolve(String objectKey) {
        if (objectKey == null || objectKey.contains("..") || objectKey.startsWith("/")) {
            throw new IllegalArgumentException("Invalid object key");
        }
        Path path = root.resolve(objectKey).normalize();
        if (!path.startsWith(root)) {
            throw new IllegalArgumentException("Invalid object key");
        }
        return path;
    }
}
