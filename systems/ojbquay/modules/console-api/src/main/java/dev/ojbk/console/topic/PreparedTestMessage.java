package dev.ojbk.console.topic;

import java.util.List;
import java.util.Map;

public record PreparedTestMessage(
        String key,
        byte[] value,
        List<String> tags,
        Map<String, String> headers,
        Integer partition) {

    public PreparedTestMessage {
        value = value.clone();
        tags = List.copyOf(tags);
        headers = Map.copyOf(headers);
    }

    @Override
    public byte[] value() {
        return value.clone();
    }
}
