package dev.ojbk.console.dlq;

public record DlqRecordRef(int partition, long offset) {
    public DlqRecordRef {
        if (partition < 0 || offset < 0) {
            throw new IllegalArgumentException(
                    "DLQ partition and offset must not be negative");
        }
    }
}
