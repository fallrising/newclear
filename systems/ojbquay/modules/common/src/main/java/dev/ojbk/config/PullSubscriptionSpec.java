package dev.ojbk.config;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public record PullSubscriptionSpec(
        int concurrency,
        int maxTps,
        String filterCel,
        List<String> tags,
        Map<String, String> transit,
        boolean dlqEnabled,
        boolean shadowTraffic,
        int maxBatch,
        int ackTimeoutMs,
        int maxRetry)
        implements DeliveryPolicy {
    public static final int MAX_INFLIGHT = 500;
    public static final int MAX_ACK_TIMEOUT_MS = 300_000;
    public static final int MAX_RETRY = 100;

    public PullSubscriptionSpec {
        if (concurrency < 1 || concurrency > MAX_INFLIGHT) {
            throw new IllegalArgumentException("concurrency must be 1..500");
        }
        if (maxTps < 1 || maxTps > PushSubscriptionSpec.MAX_TPS) {
            throw new IllegalArgumentException("maxTps must be 1..1000000");
        }
        filterCel = filterCel == null ? "" : filterCel;
        tags = List.copyOf(java.util.Objects.requireNonNull(tags, "tags"));
        transit = Map.copyOf(java.util.Objects.requireNonNull(transit, "transit"));
        if (maxBatch < 1 || maxBatch > concurrency) {
            throw new IllegalArgumentException(
                    "pull.maxBatch must be 1..concurrency");
        }
        if (ackTimeoutMs < 1_000 || ackTimeoutMs > MAX_ACK_TIMEOUT_MS) {
            throw new IllegalArgumentException(
                    "pull.ackTimeoutMs must be 1000..300000");
        }
        if (maxRetry < 0 || maxRetry > MAX_RETRY) {
            throw new IllegalArgumentException("pull.maxRetry must be 0..100");
        }
    }

    public static PullSubscriptionSpec from(Map<String, Object> raw) {
        Map<String, Object> spec = Map.copyOf(java.util.Objects.requireNonNull(raw, "raw"));
        if (!"PULL".equals(text(spec, "mode"))) {
            throw new IllegalArgumentException("pull spec.mode must be PULL");
        }
        if (bool(spec, "ordered", false)) {
            throw new IllegalArgumentException("ordered pull subscriptions are unsupported");
        }
        int concurrency = boundedInt(spec, "concurrency", 1, MAX_INFLIGHT);
        Map<String, Object> pull = objectMap(spec, "pull");
        return new PullSubscriptionSpec(
                concurrency,
                boundedInt(spec, "maxTps", 1, PushSubscriptionSpec.MAX_TPS),
                optionalText(spec, "filterCel"),
                stringList(spec.get("tags"), "tags", 64, 128),
                stringMap(spec.get("transit"), "transit", 64, 512),
                bool(spec, "dlqEnabled", false),
                bool(spec, "shadowTraffic", false),
                boundedInt(pull, "maxBatch", 1, concurrency),
                boundedInt(pull, "ackTimeoutMs", 1_000, MAX_ACK_TIMEOUT_MS),
                optionalBoundedInt(pull, "maxRetry", 3, 0, MAX_RETRY));
    }

    public int maxInflight() {
        return concurrency;
    }

    private static List<String> stringList(
            Object raw, String field, int maxSize, int maxLength) {
        if (raw == null) {
            return List.of();
        }
        if (!(raw instanceof List<?> values) || values.size() > maxSize) {
            throw new IllegalArgumentException(field + " exceeds its supported size");
        }
        List<String> result = new ArrayList<>(values.size());
        Set<String> unique = new HashSet<>();
        for (Object value : values) {
            if (!(value instanceof String text)
                    || text.isBlank()
                    || text.length() > maxLength
                    || !unique.add(text)) {
                throw new IllegalArgumentException(field + " contains an invalid value");
            }
            result.add(text);
        }
        return List.copyOf(result);
    }

    private static Map<String, String> stringMap(
            Object raw, String field, int maxSize, int maxValueLength) {
        if (raw == null) {
            return Map.of();
        }
        if (!(raw instanceof Map<?, ?> values) || values.size() > maxSize) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        Map<String, String> result = new LinkedHashMap<>();
        values.forEach((key, value) -> {
            if (!(key instanceof String name)
                    || name.isBlank()
                    || name.length() > 512
                    || !(value instanceof String text)
                    || text.isBlank()
                    || text.length() > maxValueLength) {
                throw new IllegalArgumentException(field + " contains an invalid entry");
            }
            result.put(name, text);
        });
        return Map.copyOf(result);
    }

    private static Map<String, Object> objectMap(
            Map<String, Object> values, String field) {
        Object raw = values.get(field);
        if (!(raw instanceof Map<?, ?> map)) {
            throw new IllegalArgumentException(field + " must be an object");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        map.forEach((key, value) -> {
            if (!(key instanceof String name)) {
                throw new IllegalArgumentException(field + " keys must be strings");
            }
            result.put(name, value);
        });
        return Map.copyOf(result);
    }

    private static String text(Map<String, Object> values, String field) {
        Object raw = values.get(field);
        if (!(raw instanceof String value) || value.isBlank()) {
            throw new IllegalArgumentException(field + " must be non-blank text");
        }
        return value;
    }

    private static String optionalText(Map<String, Object> values, String field) {
        Object raw = values.get(field);
        if (raw == null) {
            return "";
        }
        if (!(raw instanceof String value)) {
            throw new IllegalArgumentException(field + " must be text");
        }
        return value;
    }

    private static boolean bool(
            Map<String, Object> values, String field, boolean defaultValue) {
        Object raw = values.get(field);
        if (raw == null) {
            return defaultValue;
        }
        if (!(raw instanceof Boolean value)) {
            throw new IllegalArgumentException(field + " must be boolean");
        }
        return value;
    }

    private static int boundedInt(
            Map<String, Object> values, String field, int minimum, int maximum) {
        Object raw = values.get(field);
        if (!(raw instanceof Number number) || !isIntegral(number)) {
            throw new IllegalArgumentException(field + " must be a whole number");
        }
        long value = number.longValue();
        if (value < minimum || value > maximum) {
            throw new IllegalArgumentException(
                    field + " must be " + minimum + ".." + maximum);
        }
        return (int) value;
    }

    private static int optionalBoundedInt(
            Map<String, Object> values,
            String field,
            int defaultValue,
            int minimum,
            int maximum) {
        if (!values.containsKey(field)) {
            return defaultValue;
        }
        return boundedInt(values, field, minimum, maximum);
    }

    private static boolean isIntegral(Number number) {
        return Double.isFinite(number.doubleValue())
                && number.doubleValue() == number.longValue();
    }
}
