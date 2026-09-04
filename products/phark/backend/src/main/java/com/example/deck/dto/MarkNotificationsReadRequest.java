package com.example.deck.dto;

import jakarta.validation.constraints.NotBlank;

public record MarkNotificationsReadRequest(
        @NotBlank(message = "through must not be blank") String through) {}
