package dev.ojbk.console.subscription;

import java.util.List;
import java.util.Map;

public record PreviewMessage(
        String key,
        String valueBase64,
        List<String> tags,
        Map<String, String> headers) {

    public PreviewMessage {
        key = key == null ? "" : key;
        valueBase64 = valueBase64 == null ? "" : valueBase64;
        tags = tags == null ? List.of() : List.copyOf(tags);
        headers = headers == null ? Map.of() : Map.copyOf(headers);
    }
}
