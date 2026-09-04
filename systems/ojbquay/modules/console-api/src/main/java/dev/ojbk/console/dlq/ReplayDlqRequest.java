package dev.ojbk.console.dlq;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record ReplayDlqRequest(@NotNull List<@NotNull @Valid DlqRecordRef> records) {
    public ReplayDlqRequest {
        if (records != null) {
            records = List.copyOf(records);
            if (records.isEmpty() || records.size() > 500) {
                throw new IllegalArgumentException(
                        "DLQ replay must contain 1..500 records");
            }
        }
    }
}
