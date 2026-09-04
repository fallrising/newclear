package dev.ojbk.console.group;

import java.util.List;

public record GroupTopicProgress(
        String topic,
        String mode,
        String unsupportedReason,
        List<PartitionProgress> partitions) {

    public GroupTopicProgress {
        partitions = List.copyOf(partitions);
    }

    static GroupTopicProgress unsupported(String topic) {
        return new GroupTopicProgress(
                topic,
                "SHARE",
                "Kafka Share Group committed offsets are not exposed by the classic API",
                List.of());
    }
}
