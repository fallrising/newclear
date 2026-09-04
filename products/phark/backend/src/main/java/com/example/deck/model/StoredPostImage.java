package com.example.deck.model;

import java.time.Instant;

public record StoredPostImage(
        long id,
        long postId,
        String storageKey,
        String contentType,
        long byteSize,
        int width,
        int height,
        String sha256,
        Instant createdAt) {}