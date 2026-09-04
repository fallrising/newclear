package dev.ojbk.gateway.consume;

import dev.ojbk.config.PushSubscriptionSpec;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

final class PushRequests {
    private PushRequests() {}

    static PushRequest from(PipelineResult result, PushSubscriptionSpec spec) {
        PushMessage message = result.message();
        Map<String, String> headers = new LinkedHashMap<>();
        copyIfPresent(message.headers(), headers, "traceparent");
        copyIfPresent(message.headers(), headers, "tracestate");
        copyIfPresent(message.headers(), headers, "baggage");
        copyIfPresent(message.headers(), headers, "content-type");
        headers.putAll(spec.http().headers());
        headers.putIfAbsent("content-type", "application/json");
        headers.put("x-ojbk-topic", message.originTopic());
        headers.put("x-ojbk-partition", Integer.toString(message.partition()));
        headers.put("x-ojbk-offset", Long.toString(message.offset()));
        headers.put("x-ojbk-delivery-count", Integer.toString(message.deliveryCount()));
        headers.put("x-ojbk-retry", Integer.toString(message.retryCount()));
        return new PushRequest(
                spec.http().urls(),
                spec.http().method(),
                Duration.ofMillis(spec.http().timeoutMs()),
                result.body(),
                headers);
    }

    private static void copyIfPresent(
            Map<String, String> source, Map<String, String> target, String name) {
        String value = source.get(name);
        if (value != null && !value.isBlank()) {
            target.put(name, value);
        }
    }
}
