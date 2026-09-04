package dev.ojbk.console.topic;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public record TopicSample(
        int partition,
        long offset,
        Instant timestamp,
        String key,
        String valueBase64,
        List<String> tags,
        Map<String, String> headers,
        boolean redacted,
        boolean celMatched) {

    public TopicSample {
        tags = List.copyOf(tags);
        headers = Map.copyOf(headers);
    }
}
