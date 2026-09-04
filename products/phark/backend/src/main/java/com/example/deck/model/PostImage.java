package com.example.deck.model;

public record PostImage(
        long id,
        String url,
        String contentType,
        int width,
        int height,
        long byteSize) {

    public static PostImage of(
            long id, String contentType, int width, int height, long byteSize) {
        return new PostImage(id, "/api/media/" + id, contentType, width, height, byteSize);
    }
}