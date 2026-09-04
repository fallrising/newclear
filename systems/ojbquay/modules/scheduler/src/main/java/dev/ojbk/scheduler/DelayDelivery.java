package dev.ojbk.scheduler;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public record DelayDelivery(
        String delayId,
        String topic,
        Instant dueAt,
        byte[] value,
        String key,
        List<String> tags,
        Map<String, String> headers,
        Integer partition) {

    public DelayDelivery {
        Objects.requireNonNull(delayId, "delayId");
        Objects.requireNonNull(topic, "topic");
        Objects.requireNonNull(dueAt, "dueAt");
        value = Objects.requireNonNull(value, "value").clone();
        tags = List.copyOf(Objects.requireNonNull(tags, "tags"));
        headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
    }

    @Override
    public byte[] value() {
        return value.clone();
    }
}
