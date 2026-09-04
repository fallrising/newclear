package dev.ojbk.console.topic;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;

public record TestMessageRequest(
        @Size(max = 1024) String key,
        @NotBlank String valueBase64,
        List<String> tags,
        Map<String, String> headers,
        Integer partition) {

    public TestMessageRequest {
        key = key == null || key.isEmpty() ? null : key;
        tags = tags == null ? List.of() : List.copyOf(tags);
        headers = headers == null ? Map.of() : Map.copyOf(headers);
    }
}
