package dev.ojbk.console.group;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record ResetOffsetRequest(
        @Min(1) long topicId,
        @NotBlank @Pattern(regexp = "(?i)TIMESTAMP|OFFSET") String mode,
        @Min(0) long value) {}
