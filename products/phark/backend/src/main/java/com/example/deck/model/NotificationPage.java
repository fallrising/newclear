package com.example.deck.model;

import java.util.List;

public record NotificationPage(
        List<NotificationItem> items,
        String nextCursor,
        String latestCursor,
        String readThroughCursor,
        long unreadCount) {}
