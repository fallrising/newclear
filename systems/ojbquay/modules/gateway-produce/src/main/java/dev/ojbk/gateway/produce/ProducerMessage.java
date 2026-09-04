package dev.ojbk.gateway.produce;

import java.util.List;
import java.util.Map;

public record ProducerMessage(
        String topic,
        String key,
        byte[] value,
        List<String> tags,
        Map<String, String> headers,
        Integer partition) {

    public ProducerMessage {
        value = value == null ? null : value.clone();
        tags = tags == null ? null : List.copyOf(tags);
        headers = headers == null ? null : Map.copyOf(headers);
    }

    @Override
    public byte[] value() {
        return value == null ? null : value.clone();
    }
}
