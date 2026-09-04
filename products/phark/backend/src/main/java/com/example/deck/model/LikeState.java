package com.example.deck.model;

public record LikeState(
        long postId,
        long likeCount,
        boolean likedByViewer) {}
