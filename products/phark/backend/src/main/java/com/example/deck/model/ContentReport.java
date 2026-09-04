package com.example.deck.model;

import java.time.Instant;

/** The intentionally redacted public representation of a content report. */
public record ContentReport(
        long id,
        ContentReportTargetType targetType,
        long targetId,
        ContentReportReason reason,
        ContentReportStatus status,
        Instant createdAt) {}
