package dev.ojbk.console.group;

import java.time.Instant;

public record PartitionProgress(
        int partition,
        Long committedOffset,
        long endOffset,
        long lag,
        Instant lastCommitAt) {}
