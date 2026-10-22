package dev.ojbk.scheduler;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import com.fasterxml.jackson.databind.ObjectWriter;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class DelayMetadataCodec {
    private final ObjectMapper mapper = new ObjectMapper();
    // Compile the fixed schema before a short deadline reaches the dispatch hot path.
    private final ObjectReader reader = mapper.readerFor(StoredMetadata.class);
    private final ObjectWriter writer = mapper.writerFor(StoredMetadata.class);

    String encode(List<String> tags, Map<String, String> headers, Integer partition) {
        try {
            return writer.writeValueAsString(new StoredMetadata(tags, headers, partition));
        } catch (JsonProcessingException failure) {
            throw new IllegalArgumentException("delay metadata cannot be encoded");
        }
    }

    StoredMetadata decode(String json) {
        try {
            return reader.readValue(json);
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
