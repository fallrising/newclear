package com.example.deck.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreatePostRequest(
        @NotBlank(message = "content must not be blank")
        @Size(max = 500, message = "content must be at most 500 characters")
        String content,

        @NotBlank(message = "channel must not be blank")
        @Pattern(regexp = "home|tech|ops", message = "channel must be home, tech, or ops")
        String channel) {
}
