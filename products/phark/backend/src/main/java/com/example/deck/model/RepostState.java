package com.example.deck.model;

public record RepostState(
        long postId,
        long repostCount,
        boolean repostedByViewer) {}
