package com.example.deck.service;

/**
 * Byte-oriented media object storage. The storage key is server-generated; this
 * boundary never exposes a {@code Path} or accepts a client-supplied filename.
 */
public interface MediaStorage {

    /**
     * Persists {@code data} and returns a server-generated lowercase UUID-v4
     * {@code storageKey} ending in {@code .} + {@code validatedExtension}.
     *
     * @param data the validated image bytes
     * @param validatedExtension {@code jpg} or {@code png} only
     * @return the storage key, safe to hand back to {@link #read} and {@link #delete}
     */
    String store(byte[] data, String validatedExtension);

    /**
     * Returns the exact bytes previously stored under {@code storageKey}.
     *
     * @param storageKey a key that satisfies the storage key grammar
     * @return the stored bytes
     * @throws MediaStorageException if the key is invalid or the bytes are unavailable
     */
    byte[] read(String storageKey);

    /**
     * Removes the stored bytes. Idempotent: deleting a missing key is a no-op.
     *
     * @param storageKey a key that satisfies the storage key grammar
     * @throws MediaStorageException if the key is invalid or removal fails
     */
    void delete(String storageKey);
}