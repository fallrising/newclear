package dev.ojbk.delay;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

public record DelayCommand(
        int schemaVersion,
        DelayAction action,
        String delayId,
        String targetTopic,
        long dueAtMs,
        byte[] value,
        String key,
        List<String> tags,
        Map<String, String> headers,
        Integer partition,
        Long loopIntervalMs,
        int loopRemaining,
        Long expireAtMs) {
    public static final int SUPPORTED_SCHEMA_VERSION = 1;
    public static final int MAX_LOOP_TIMES = 10_000;
    public static final long MAX_DELAY_MS = 30L * 24 * 60 * 60 * 1_000;
    public static final String INBOX_TOPIC = "__ojbk.delay.inbox";
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");

    public DelayCommand {
        if (schemaVersion != SUPPORTED_SCHEMA_VERSION) {
            throw new IllegalArgumentException("unsupported delay command schema");
        }
        Objects.requireNonNull(action, "action");
        if (delayId == null || !ID.matcher(delayId).matches()) {
            throw new IllegalArgumentException("delayId contains unsupported characters");
        }
        if (targetTopic == null || targetTopic.isBlank()) {
            throw new IllegalArgumentException("targetTopic must not be blank");
        }
        value = value == null ? null : value.clone();
        tags = tags == null ? List.of() : List.copyOf(tags);
        headers = headers == null ? Map.of() : Map.copyOf(headers);
        if (partition != null && partition < 0) {
            throw new IllegalArgumentException("partition must not be negative");
        }
        if (action == DelayAction.ADD) {
            validateAdd(
                    dueAtMs, value, loopIntervalMs, loopRemaining, expireAtMs);
        } else {
            if (dueAtMs != 0
                    || value == null
                    || value.length != 0
                    || key != null
                    || !tags.isEmpty()
                    || !headers.isEmpty()
                    || partition != null
                    || loopIntervalMs != null
                    || loopRemaining != 0
                    || expireAtMs != null) {
                throw new IllegalArgumentException("cancel command has invalid scheduling fields");
            }
        }
    }

    @Override
    public byte[] value() {
        return value == null ? null : value.clone();
    }

    public static DelayCommand cancel(String delayId, String targetTopic) {
        return new DelayCommand(
                SUPPORTED_SCHEMA_VERSION,
                DelayAction.CANCEL,
                delayId,
                targetTopic,
                0,
                new byte[0],
                null,
                List.of(),
                Map.of(),
                null,
                null,
                0,
                null);
    }

    private static void validateAdd(
            long dueAtMs,
            byte[] value,
            Long loopIntervalMs,
            int loopRemaining,
            Long expireAtMs) {
        if (dueAtMs < 1) {
            throw new IllegalArgumentException("dueAtMs must be positive");
        }
        if (value == null) {
            throw new IllegalArgumentException("ADD value must not be null");
        }
        if (loopRemaining < 1 || loopRemaining > MAX_LOOP_TIMES) {
            throw new IllegalArgumentException("loopRemaining must be 1..10000");
        }
        if (loopRemaining > 1 && (loopIntervalMs == null || loopIntervalMs < 1)) {
            throw new IllegalArgumentException("recurrence requires a positive interval");
        }
        if (loopIntervalMs != null && loopIntervalMs > MAX_DELAY_MS) {
            throw new IllegalArgumentException("loop interval exceeds the 30 day limit");
        }
        if (loopRemaining == 1 && loopIntervalMs != null) {
            throw new IllegalArgumentException("single occurrence cannot have a loop interval");
        }
        if (expireAtMs != null && expireAtMs <= dueAtMs) {
            throw new IllegalArgumentException("expireAtMs must be after dueAtMs");
        }
    }

    @Override
    public boolean equals(Object candidate) {
        if (this == candidate) {
            return true;
        }
        if (!(candidate instanceof DelayCommand other)) {
            return false;
        }
        return schemaVersion == other.schemaVersion
                && dueAtMs == other.dueAtMs
                && loopRemaining == other.loopRemaining
                && action == other.action
                && delayId.equals(other.delayId)
                && targetTopic.equals(other.targetTopic)
                && Arrays.equals(value, other.value)
                && Objects.equals(key, other.key)
                && tags.equals(other.tags)
                && headers.equals(other.headers)
                && Objects.equals(partition, other.partition)
                && Objects.equals(loopIntervalMs, other.loopIntervalMs)
                && Objects.equals(expireAtMs, other.expireAtMs);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(
                schemaVersion,
                action,
                delayId,
                targetTopic,
                dueAtMs,
                key,
                tags,
                headers,
                partition,
                loopIntervalMs,
                loopRemaining,
                expireAtMs);
        return 31 * result + Arrays.hashCode(value);
    }
}
