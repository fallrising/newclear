package dev.ojbk.sdk;

import java.util.List;
import java.util.Map;
import java.util.Objects;

public record OjbkDelivery(
        String topic,
        int partition,
        long offset,
        String key,
        byte[] value,
        List<String> tags,
        Map<String, String> headers,
        String ackToken,
        int deliveryCount) {
    public OjbkDelivery {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (partition < 0 || offset < 0) {
            throw new IllegalArgumentException(
                    "partition and offset must not be negative");
        }
        value = Objects.requireNonNull(value, "value").clone();
        tags = List.copyOf(Objects.requireNonNull(tags, "tags"));
        headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
        if (ackToken == null || ackToken.isBlank()) {
            throw new IllegalArgumentException("ackToken must not be blank");
        }
        if (deliveryCount < 1) {
            throw new IllegalArgumentException(
                    "deliveryCount must be positive");
        }
    }

    @Override
    public byte[] value() {
        return value.clone();
    }
}
