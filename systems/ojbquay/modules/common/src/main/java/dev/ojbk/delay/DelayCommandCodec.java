package dev.ojbk.delay;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Objects;

public final class DelayCommandCodec {
    private final ObjectMapper objectMapper = new ObjectMapper();

    public byte[] encode(DelayCommand command) {
        try {
            return objectMapper.writeValueAsBytes(Objects.requireNonNull(command, "command"));
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("delay command cannot be encoded");
        }
    }

    public DelayCommand decode(byte[] encoded) {
        try {
            return objectMapper.readValue(
                    Objects.requireNonNull(encoded, "encoded"), DelayCommand.class);
        } catch (IOException exception) {
            throw new IllegalArgumentException("delay command cannot be decoded");
        }
    }
}
