package dev.ojbk.pipeline;

import java.util.List;
import java.util.Map;

public record MessageVariables(
        String key,
        List<String> tags,
        Map<String, String> headers,
        Object body,
        byte[] bodyRaw) {

    public MessageVariables {
        key = key == null ? "" : key;
        tags = List.copyOf(tags);
        headers = Map.copyOf(headers);
        bodyRaw = bodyRaw.clone();
    }

    @Override
    public byte[] bodyRaw() {
        return bodyRaw.clone();
    }
}
