package com.example.deck.model;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

public record SearchCursor(Instant createdAt, long id) {

    public SearchCursor {
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        createdAt = createdAt.truncatedTo(ChronoUnit.SECONDS);
    }
}