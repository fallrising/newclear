package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpRequest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class JdkPushHttpClientTest {
    @Test
    void retriesOnlyTransportFailuresAtTwoBoundedBackoffs() {
        AtomicInteger attempts = new AtomicInteger();
        List<Duration> sleeps = new ArrayList<>();
        JdkPushHttpClient client = new JdkPushHttpClient(
                request -> {
                    if (attempts.getAndIncrement() < 2) {
                        throw new IOException("connection reset");
                    }
                    return 204;
                },
                sleeps::add,
                urls -> URI.create(urls.getFirst()));

        PushHttpResult result = client.deliver(request());

        assertThat(result.success()).isTrue();
        assertThat(result.statusCode()).isEqualTo(204);
        assertThat(result.attempts()).isEqualTo(3);
        assertThat(sleeps)
                .containsExactly(Duration.ofMillis(200), Duration.ofMillis(400));
    }

    @Test
    void doesNotFastRetryAnHttpBusinessFailure() {
        AtomicInteger attempts = new AtomicInteger();
        List<Duration> sleeps = new ArrayList<>();
        JdkPushHttpClient client = new JdkPushHttpClient(
                request -> {
                    attempts.incrementAndGet();
                    return 503;
                },
                sleeps::add,
                urls -> URI.create(urls.getFirst()));

        PushHttpResult result = client.deliver(request());

        assertThat(result.success()).isFalse();
        assertThat(result.transportFailure()).isFalse();
        assertThat(result.statusCode()).isEqualTo(503);
        assertThat(result.attempts()).isEqualTo(1);
        assertThat(attempts).hasValue(1);
        assertThat(sleeps).isEmpty();
    }

    private static PushRequest request() {
        return new PushRequest(
                List.of("https://service.example/callback"),
                "POST",
                Duration.ofSeconds(5),
                "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                Map.of("traceparent", "00-test"));
    }
}
