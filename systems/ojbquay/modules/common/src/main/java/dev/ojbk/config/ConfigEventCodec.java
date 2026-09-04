package dev.ojbk.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.io.IOException;

public final class ConfigEventCodec {
    private final ObjectMapper objectMapper;

    public ConfigEventCodec() {
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    public byte[] encode(ConfigEvent event) {
        try {
            return objectMapper.writeValueAsBytes(event);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("config event cannot be encoded", exception);
        }
    }

    public ConfigEvent decode(byte[] bytes) {
        try {
            return objectMapper.readValue(bytes, ConfigEvent.class);
        } catch (IOException exception) {
            throw new IllegalArgumentException("config event cannot be decoded", exception);
        }
    }
}
