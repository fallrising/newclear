package com.example.deck.model;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Objects;

public record PostCursor(Instant createdAt, TimelineEntryKind entryKind, long id) {

    public PostCursor {
        createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null")
                .truncatedTo(ChronoUnit.SECONDS);
        Objects.requireNonNull(entryKind, "entryKind must not be null");
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
    }

    public PostCursor(Instant createdAt, long id) {
        this(createdAt, TimelineEntryKind.POST, id);
    }
}
