package dev.ojbk.console.group;

import java.util.List;

public record GroupOffsetReset(
        String group, String topic, List<PartitionOffset> offsets) {

    public GroupOffsetReset {
        offsets = List.copyOf(offsets);
    }
}
