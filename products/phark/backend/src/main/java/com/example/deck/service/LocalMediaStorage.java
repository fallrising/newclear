package com.example.deck.service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * Local filesystem adapter for {@link MediaStorage}. All keys are
 * server-generated lowercase UUID-v4 filenames locked inside a single configured
 * root; the adapter owns every normalized-path, grammar, symlink and
 * temp/atomic-move concern so no filesystem detail leaks to callers.
 *
 * <p>The configured root is revalidated in full (every existing path component,
 * never following links) before directory creation in the constructor and before
 * every store/read/delete, so the root cannot be swapped for a symlink or moved
 * after construction. Store targets go through the same guarded resolution as
 * read/delete and never overwrite or follow a pre-existing file.
 */
public class LocalMediaStorage implements MediaStorage {

    private static final Pattern KEY_GRAMMAR = Pattern.compile(
            "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(jpg|png)");
    private static final Set<String> VALID_EXTENSIONS = Set.of("jpg", "png");

    private final Path root;
    private final Supplier<UUID> uuidSupplier;

    public LocalMediaStorage(Path root) {
        this(root, UUID::randomUUID);
    }

    LocalMediaStorage(Path root, Supplier<UUID> uuidSupplier) {
        this.uuidSupplier = uuidSupplier;
        this.root = root.toAbsolutePath().normalize();
        validateExistingRootComponents();
        try {
            Files.createDirectories(this.root);
        } catch (IOException exception) {
            throw new MediaStorageException("Failed to create media root", exception);
        }
        validateRoot();
    }

    @Override
    public String store(byte[] data, String validatedExtension) {
        if (data == null) {
            throw new MediaStorageException("Stored data must not be null");
        }
        if (!VALID_EXTENSIONS.contains(validatedExtension)) {
            throw new MediaStorageException("Unsupported media extension");
        }
        validateRoot();

        String storageKey = generateKey(validatedExtension);
        Path target = resolveTargetForStore(storageKey);
        Path temp = null;
        try {
            temp = Files.createTempFile(this.root, ".media-", ".tmp");
            Files.write(temp, data);
            Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE);
            return storageKey;
        } catch (IOException exception) {
            cleanup(temp);
            throw new MediaStorageException("Failed to store media", exception);
        }
    }

    @Override
    public byte[] read(String storageKey) {
        Path target = resolveSafe(storageKey);
        try {
            return Files.readAllBytes(target);
        } catch (IOException exception) {
            throw new MediaStorageException("Failed to read stored media", exception);
        }
    }

    @Override
    public void delete(String storageKey) {
        Path target = resolveSafe(storageKey);
        try {
            Files.deleteIfExists(target);
        } catch (IOException exception) {
            throw new MediaStorageException("Failed to delete stored media", exception);
        }
    }

    private String generateKey(String validatedExtension) {
        String storageKey = this.uuidSupplier.get().toString() + "." + validatedExtension;
        if (!KEY_GRAMMAR.matcher(storageKey).matches()) {
            throw new MediaStorageException("Generated storage key failed the expected grammar");
        }
        return storageKey;
    }

    /**
     * Guarded resolution for an already-generated store target: the key must stay
     * inside the root, the final target must not be a symlink, and it must not
     * already exist. Any pre-existing file or link is preserved untouched.
     */
    private Path resolveTargetForStore(String storageKey) {
        Path target = this.root.resolve(storageKey).normalize();
        if (!target.startsWith(this.root)) {
            throw new MediaStorageException("Storage key escapes the media root");
        }
        try {
            Files.readAttributes(target, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
        } catch (NoSuchFileException exception) {
            return target;
        } catch (IOException exception) {
            throw new MediaStorageException("Cannot inspect media target", exception);
        }
        if (Files.isSymbolicLink(target)) {
            throw new MediaStorageException("Storage key resolves to a symbolic link");
        }
        throw new MediaStorageException("Storage target already exists");
    }

    private Path resolveSafe(String storageKey) {
        if (storageKey == null || !KEY_GRAMMAR.matcher(storageKey).matches()) {
            throw new MediaStorageException("Storage key does not match the expected grammar");
        }
        validateRoot();
        Path target = this.root.resolve(storageKey).normalize();
        if (!target.startsWith(this.root) || Files.isSymbolicLink(target)) {
            throw new MediaStorageException("Storage key escapes the media root");
        }
        return target;
    }

    private void validateExistingRootComponents() {
        try {
            for (Path component : rootComponents()) {
                BasicFileAttributes attributes;
                try {
                    attributes = Files.readAttributes(
                            component, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                } catch (NoSuchFileException exception) {
                    continue;
                }
                requireRealDirectory(component, attributes);
            }
        } catch (IOException exception) {
            throw new MediaStorageException("Cannot inspect media root", exception);
        }
    }

    private void validateRoot() {
        try {
            for (Path component : rootComponents()) {
                BasicFileAttributes attributes = Files.readAttributes(
                        component, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
                requireRealDirectory(component, attributes);
            }
        } catch (NoSuchFileException exception) {
            throw new MediaStorageException("Media root is unavailable", exception);
        } catch (IOException exception) {
            throw new MediaStorageException("Cannot inspect media root", exception);
        }
    }

    private void requireRealDirectory(Path component, BasicFileAttributes attributes) {
        if (attributes.isSymbolicLink()) {
            throw new MediaStorageException("Media root must not traverse symbolic links");
        }
        if (!attributes.isDirectory()) {
            throw new MediaStorageException("Media root must be a real directory");
        }
    }

    private List<Path> rootComponents() {
        List<Path> components = new ArrayList<>();
        Path current = this.root;
        while (current != null) {
            components.add(current);
            current = current.getParent();
        }
        Collections.reverse(components);
        return components;
    }

    private void cleanup(Path temp) {
        if (temp == null) {
            return;
        }
        try {
            Files.deleteIfExists(temp);
        } catch (IOException ignored) {
            // Best-effort cleanup; the original failure already wins.
        }
    }
}