package dev.ojbk.gateway.produce;

import java.util.Map;

public record BrokerRecord(
        String topic,
        Integer partition,
        String key,
        byte[] value,
        Map<String, String> headers) {

    public BrokerRecord {
        value = value.clone();
        headers = Map.copyOf(headers);
    }

    @Override
    public byte[] value() {
        return value.clone();
    }
}
