package com.example.deck.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateReplyRequest(
        @NotBlank(message = "content must not be blank")
        @Size(max = 500, message = "content must be at most 500 characters")
        String content) {
}
