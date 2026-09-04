package com.example.deck.dto;

import com.example.deck.model.ContentReportReason;
import jakarta.validation.constraints.NotNull;

public record CreateContentReportRequest(@NotNull(message = "reason must not be null")
                                         ContentReportReason reason) {}
