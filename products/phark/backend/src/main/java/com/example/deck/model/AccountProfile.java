package com.example.deck.model;

import java.time.Instant;

public record AccountProfile(
        String handle,
        String displayName,
        String bio,
        Instant createdAt) {}
