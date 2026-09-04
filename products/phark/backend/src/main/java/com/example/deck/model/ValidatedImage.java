package com.example.deck.model;

public record ValidatedImage(
        byte[] bytes,
        String contentType,
        String extension,
        int byteSize,
        int width,
        int height,
        String sha256) {

    public ValidatedImage {
        bytes = bytes.clone();
    }

    @Override
    public byte[] bytes() {
        return bytes.clone();
    }
}