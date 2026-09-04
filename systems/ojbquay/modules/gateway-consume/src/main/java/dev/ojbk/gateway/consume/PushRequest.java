package dev.ojbk.gateway.consume;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public record PushRequest(
        List<String> urls,
        String method,
        Duration timeout,
        byte[] body,
        Map<String, String> headers) {

    public PushRequest {
        urls = List.copyOf(Objects.requireNonNull(urls, "urls"));
        if (urls.isEmpty()) {
            throw new IllegalArgumentException("urls must not be empty");
        }
        if (!java.util.Set.of("GET", "POST").contains(method)) {
            throw new IllegalArgumentException("method must be GET or POST");
        }
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        body = Objects.requireNonNull(body, "body").clone();
        headers = Map.copyOf(Objects.requireNonNull(headers, "headers"));
    }

    @Override
    public byte[] body() {
        return body.clone();
    }
}
