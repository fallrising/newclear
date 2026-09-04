package dev.ojbk.console.security;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateUserRequest(
        @NotBlank
                @Size(max = 64)
                @Pattern(regexp = "[A-Za-z][A-Za-z0-9._-]*")
                String username,
        @NotBlank @Size(min = 12, max = 128) String password,
        @NotBlank @Pattern(regexp = "ADMIN|OPS|USER") String role) {}
