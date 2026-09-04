package dev.ojbk.gateway.consume;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.apache.kafka.clients.consumer.ConsumerRecord;

public record PushMessage(
        String topic,
        int partition,
        long offset,
        Instant timestamp,
        String key,
        byte[] value,
        List<String> tags,
        Map<String, String> headers,
        int deliveryCount) {

    public PushMessage {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (partition < 0 || offset < 0) {
            throw new IllegalArgumentException("partition and offset must not be negative");
        }
        Objects.requireNonNull(timestamp, "timestamp");
        value = Objects.requireNonNull(value, "value").clone();
        tags = List.copyOf(Objects.requireNonNull(tags, "tags"));
        headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
        if (deliveryCount < 1) {
            throw new IllegalArgumentException("deliveryCount must be positive");
        }
    }

    @Override
    public byte[] value() {
        return value.clone();
    }

    public String originTopic() {
        String origin = headers.get("x-ojbk-origin-topic");
        return origin == null || origin.isBlank() ? topic : origin;
    }

    public int retryCount() {
        String raw = headers.get("x-ojbk-retry");
        if (raw == null) {
            return 0;
        }
        try {
            int parsed = Integer.parseInt(raw);
            return Math.max(0, parsed);
        } catch (NumberFormatException invalid) {
            return 0;
        }
    }

    static PushMessage from(ConsumerRecord<byte[], byte[]> record) {
        Objects.requireNonNull(record, "record");
        Map<String, String> headers = new LinkedHashMap<>();
        record.headers().forEach(header -> headers.put(
                header.key(),
                header.value() == null
                        ? ""
                        : new String(header.value(), StandardCharsets.UTF_8)));
        String encodedTags = headers.get("x-ojbk-tags");
        List<String> tags = encodedTags == null || encodedTags.isBlank()
                ? List.of()
                : java.util.Arrays.stream(encodedTags.split(","))
                        .filter(tag -> !tag.isBlank())
                        .toList();
        long timestamp = Math.max(0, record.timestamp());
        return new PushMessage(
                record.topic(),
                record.partition(),
                record.offset(),
                Instant.ofEpochMilli(timestamp),
                record.key() == null
                        ? null
                        : new String(record.key(), StandardCharsets.UTF_8),
                record.value() == null ? new byte[0] : record.value(),
                tags,
                headers,
                record.deliveryCount().map(Short::intValue).orElse(1));
    }
}
