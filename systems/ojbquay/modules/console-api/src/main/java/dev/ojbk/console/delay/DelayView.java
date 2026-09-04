package dev.ojbk.console.delay;

import java.time.Instant;

public record DelayView(
        String delayId,
        String targetTopic,
        String status,
        Instant dueAt,
        Instant createdAt,
        Instant firedAt,
        Long loopIntervalMs,
        Integer loopRemaining,
        Instant expireAt,
        int payloadBytes,
        boolean cancelRequested) {}
