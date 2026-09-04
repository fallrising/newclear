package dev.ojbk.scheduler;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class DelayMetadataCodec {
    private final ObjectMapper mapper = new ObjectMapper();

    String encode(List<String> tags, Map<String, String> headers, Integer partition) {
        try {
            return mapper.writeValueAsString(new StoredMetadata(tags, headers, partition));
        } catch (JsonProcessingException failure) {
            throw new IllegalArgumentException("delay metadata cannot be encoded");
        }
    }

    StoredMetadata decode(String json) {
        try {
            return mapper.readValue(json, StoredMetadata.class);
        } catch (JsonProcessingException failure) {
            throw new IllegalArgumentException("delay metadata cannot be decoded");
        }
    }

    record StoredMetadata(
            List<String> tags, Map<String, String> headers, Integer partition) {
        StoredMetadata {
            tags = List.copyOf(Objects.requireNonNull(tags, "tags"));
            headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
        }
    }
}
