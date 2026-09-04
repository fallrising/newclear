package dev.ojbk.console.topic;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record UpdateTopicRequest(
        @Min(1) @Max(4_194_304) int maxMessageBytes,
        @Min(1) long retentionMs,
        @Min(1) int produceQuotaTps,
        @NotBlank
                @Pattern(regexp = "none|gzip|snappy|lz4|zstd", flags = Pattern.Flag.CASE_INSENSITIVE)
                String compression,
        @Size(max = 500) String remark) {}
