package com.example.deck.model;

import java.time.Instant;

public record NotificationItem(
        long id,
        NotificationType type,
        String actor,
        String actorHandle,
        long postId,
        String postContent,
        Long replyId,
        String replyContent,
        Instant createdAt,
        boolean read) {}
