package dev.ojbk.config;

import dev.ojbk.delay.DelayCommand;
import java.net.URI;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.OptionalLong;
import java.util.Set;
import java.util.regex.Pattern;

public record PushSubscriptionSpec(
        int concurrency,
        int maxTps,
        String filterCel,
        List<String> tags,
        Map<String, String> transit,
        boolean ordered,
        OrderKeySource orderKeySource,
        String orderKeyExpr,
        boolean dlqEnabled,
        boolean shadowTraffic,
        Http http)
        implements DeliveryPolicy {
    public static final int MAX_CONCURRENCY = 500;
    public static final int MAX_TPS = 1_000_000;
    private static final int MAX_RETRY_INTERVALS = 100;

    public PushSubscriptionSpec {
        if (concurrency < 1 || concurrency > MAX_CONCURRENCY) {
            throw new IllegalArgumentException("concurrency must be 1..500");
        }
        if (maxTps < 1 || maxTps > MAX_TPS) {
            throw new IllegalArgumentException("maxTps must be 1..1000000");
        }
        filterCel = filterCel == null ? "" : filterCel;
        tags = List.copyOf(tags);
        transit = Map.copyOf(transit);
        if (ordered && orderKeySource == null) {
            throw new IllegalArgumentException("ordered push requires an order key source");
        }
        orderKeyExpr = orderKeyExpr == null ? "" : orderKeyExpr;
        if (ordered && orderKeySource != OrderKeySource.KEY && orderKeyExpr.isBlank()) {
            throw new IllegalArgumentException("ordered push requires an order key expression");
        }
        if (orderKeyExpr.length() > 512) {
            throw new IllegalArgumentException("order key expression is too long");
        }
        if (ordered
                && orderKeySource == OrderKeySource.JSONPATH
                && !orderKeyExpr.startsWith("$")) {
            throw new IllegalArgumentException("JSONPATH order key must start with '$'");
        }
        java.util.Objects.requireNonNull(http, "http");
    }

    public static PushSubscriptionSpec from(Map<String, Object> raw) {
        Map<String, Object> spec = Map.copyOf(java.util.Objects.requireNonNull(raw, "raw"));
        if (!"PUSH".equals(text(spec, "mode"))) {
            throw new IllegalArgumentException("push spec.mode must be PUSH");
        }
        int concurrency = boundedInt(spec, "concurrency", 1, MAX_CONCURRENCY);
        int maxTps = boundedInt(spec, "maxTps", 1, MAX_TPS);
        String filterCel = optionalText(spec, "filterCel");
        List<String> tags = stringList(spec.get("tags"), "tags", 64, 128);
        Map<String, String> transit =
                stringMap(spec.get("transit"), "transit", 64, 512);
        boolean ordered = bool(spec, "ordered", false);
        OrderKeySource source = ordered
                ? enumValue(spec, "orderKeySource", OrderKeySource.class)
                : OrderKeySource.KEY;
        String expression = optionalText(spec, "orderKeyExpr");
        boolean dlq = bool(spec, "dlqEnabled", false);
        boolean shadow = bool(spec, "shadowTraffic", false);
        return new PushSubscriptionSpec(
                concurrency,
                maxTps,
                filterCel,
                tags,
                transit,
                ordered,
                source,
                expression,
                dlq,
                shadow,
                http(objectMap(spec, "push")));
    }

    public OptionalLong retryDelayMs(int retryCount) {
        if (retryCount < 0) {
            throw new IllegalArgumentException("retryCount must not be negative");
        }
        List<Long> intervals = http.retryIntervalsMs();
        boolean repeats = intervals.getLast() == -1;
        if (repeats) {
            int index = Math.min(retryCount, intervals.size() - 2);
            return OptionalLong.of(intervals.get(index));
        }
        return retryCount < intervals.size()
                ? OptionalLong.of(intervals.get(retryCount))
                : OptionalLong.empty();
    }

    private static Http http(Map<String, Object> push) {
        List<String> urls = stringList(push.get("urls"), "push.urls", 32, 2_048);
        for (String url : urls) {
            URI uri;
            try {
                uri = URI.create(url);
            } catch (IllegalArgumentException invalid) {
                throw new IllegalArgumentException("push URL is invalid");
            }
            if (!Set.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null) {
                throw new IllegalArgumentException("push URL must use http or https");
            }
            if (uri.getRawUserInfo() != null) {
                throw new IllegalArgumentException("push URL must not contain credentials");
            }
        }
        String method = text(push, "method").toUpperCase(Locale.ROOT);
        if (!Set.of("GET", "POST").contains(method)) {
            throw new IllegalArgumentException("push method must be GET or POST");
        }
        int timeoutMs = boundedInt(push, "timeoutMs", 1, 60_000);
        List<Long> retryIntervals =
                longList(push.get("retryIntervalsMs"), "push.retryIntervalsMs");
        Map<String, String> headers =
                stringMap(push.get("headers"), "push.headers", 32, 8_192);
        validateHeaders(headers);
        return new Http(urls, method, timeoutMs, retryIntervals, headers);
    }

    private static List<Long> longList(Object raw, String field) {
        if (!(raw instanceof List<?> values)
                || values.isEmpty()
                || values.size() > MAX_RETRY_INTERVALS) {
            throw new IllegalArgumentException(field + " must contain 1..100 values");
        }
        List<Long> result = new ArrayList<>(values.size());
        for (int index = 0; index < values.size(); index++) {
            Object value = values.get(index);
            if (!(value instanceof Number number) || !isIntegral(number)) {
                throw new IllegalArgumentException(field + " must contain whole numbers");
            }
            long interval = number.longValue();
            boolean infinite = interval == -1 && index == values.size() - 1 && index > 0;
            if ((!infinite && interval < 1)
                    || interval > DelayCommand.MAX_DELAY_MS) {
                throw new IllegalArgumentException(
                        field + " must be positive; trailing -1 repeats the previous value");
            }
            result.add(interval);
        }
        return List.copyOf(result);
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
            Object raw,
            String field,
            int maxSize,
            int maxValueLength) {
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

    private static void validateHeaders(Map<String, String> headers) {
        Pattern name = Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
        Set<String> forbidden =
                Set.of("host", "content-length", "connection", "transfer-encoding");
        headers.forEach((key, value) -> {
            if (!name.matcher(key).matches()
                    || forbidden.contains(key.toLowerCase(Locale.ROOT))
                    || value.indexOf('\r') >= 0
                    || value.indexOf('\n') >= 0) {
                throw new IllegalArgumentException("push.headers contains an unsafe entry");
            }
        });
    }

    private static Map<String, Object> objectMap(Map<String, Object> values, String field) {
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

    private static boolean isIntegral(Number number) {
        return Double.isFinite(number.doubleValue())
                && number.doubleValue() == number.longValue();
    }

    private static <E extends Enum<E>> E enumValue(
            Map<String, Object> values, String field, Class<E> type) {
        String raw = text(values, field);
        try {
            return Enum.valueOf(type, raw);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException(field + " is unsupported");
        }
    }

    public enum OrderKeySource {
        KEY,
        HEADER,
        JSONPATH
    }

    public record Http(
            List<String> urls,
            String method,
            int timeoutMs,
            List<Long> retryIntervalsMs,
            Map<String, String> headers) {
        public Http {
            urls = List.copyOf(urls);
            retryIntervalsMs = List.copyOf(retryIntervalsMs);
            headers = Map.copyOf(headers);
        }
    }
}
