package dev.ojbk.console.dlq;

import java.time.Instant;
import java.util.Map;

public record DlqRecordView(
        int partition,
        long offset,
        Instant timestamp,
        String key,
        String valueBase64,
        Map<String, String> headers) {
    public DlqRecordView {
        headers = Map.copyOf(headers);
    }
}
