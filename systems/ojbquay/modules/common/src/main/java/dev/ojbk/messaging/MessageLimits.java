package dev.ojbk.messaging;

public final class MessageLimits {
    public static final int MAX_VALUE_BYTES = 4_194_304;
    public static final int MAX_KEY_CHARS = 1_024;
    public static final int MAX_KAFKA_RECORD_OVERHEAD_BYTES = 2_300_000;
    public static final int MAX_KAFKA_REQUEST_BYTES =
            MAX_VALUE_BYTES + MAX_KAFKA_RECORD_OVERHEAD_BYTES;
    public static final int MAX_DELAY_COMMAND_BYTES = 10_000_000;
    public static final int MAX_DELAY_FETCH_BYTES = 11_000_000;

    private MessageLimits() {}

    public static int kafkaRecordLimit(int valueLimit) {
        if (valueLimit < 1 || valueLimit > MAX_VALUE_BYTES) {
            throw new IllegalArgumentException("value limit must be 1..4194304");
        }
        return valueLimit + MAX_KAFKA_RECORD_OVERHEAD_BYTES;
    }
}
