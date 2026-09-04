package dev.ojbk.console.group;

import java.time.Duration;
import java.util.List;

public interface GroupOperations {
    List<PartitionProgress> classicProgress(
            String group, String topic, int partitions);

    boolean awaitEmpty(String group, Duration timeout);

    GroupOffsetReset reset(
            String group,
            String topic,
            int partitions,
            String mode,
            long value);
}
