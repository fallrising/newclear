package com.example.deck.model;

import java.time.Instant;

public record Account(
        long id,
        String handle,
        String displayName,
        String bio,
        String passwordHash,
        Instant createdAt,
        Instant updatedAt) {}
