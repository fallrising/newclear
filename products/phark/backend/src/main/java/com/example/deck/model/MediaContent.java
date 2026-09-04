package com.example.deck.model;

/**
 * Public read boundary for stored media. Exposes only the public metadata ID,
 * the canonical content type, and the verified bytes; storage keys, paths,
 * SHA-256 values, and client filenames never cross this boundary.
 */
public record MediaContent(long id, String contentType, byte[] bytes) {

    public MediaContent {
        bytes = bytes.clone();
    }

    @Override
    public byte[] bytes() {
        return bytes.clone();
    }
}