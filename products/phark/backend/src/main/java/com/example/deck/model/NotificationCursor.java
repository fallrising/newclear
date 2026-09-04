package com.example.deck.model;

public record NotificationCursor(long id) {

    public NotificationCursor {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
    }
}
