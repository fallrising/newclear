package dev.ojbk.sdk;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

public record OjbkMessage(
        String topic,
        String key,
        byte[] value,
        List<String> tags,
        Map<String, String> headers,
        Integer partition) {

    public OjbkMessage {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (value == null) {
            throw new IllegalArgumentException("value must not be null");
        }
        value = value.clone();
        tags = tags == null ? List.of() : List.copyOf(tags);
        headers = headers == null ? Map.of() : Map.copyOf(headers);
        if (partition != null && partition < 0) {
            throw new IllegalArgumentException("partition must not be negative");
        }
    }

    @Override
    public byte[] value() {
        return value.clone();
    }

    public static OjbkMessage ofUtf8(String topic, String value) {
        if (value == null) {
            throw new IllegalArgumentException("value must not be null");
        }
        return new OjbkMessage(
                topic, null, value.getBytes(StandardCharsets.UTF_8), List.of(), Map.of(), null);
    }
}
