package com.example.deck.dto;

import com.example.deck.model.ContentReport;
import com.example.deck.model.ContentReportReason;
import com.example.deck.model.ContentReportStatus;
import com.example.deck.model.ContentReportTargetType;
import java.time.Instant;

public record ContentReportResponse(
        long id,
        ContentReportTargetType targetType,
        long targetId,
        ContentReportReason reason,
        ContentReportStatus status,
        Instant createdAt) {

    public static ContentReportResponse from(ContentReport report) {
        return new ContentReportResponse(report.id(), report.targetType(), report.targetId(),
                report.reason(), report.status(), report.createdAt());
    }
}
