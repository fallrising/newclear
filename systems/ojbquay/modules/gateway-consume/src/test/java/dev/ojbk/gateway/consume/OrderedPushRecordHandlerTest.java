package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.SubscriptionConfig;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class OrderedPushRecordHandlerTest {
    @Test
    void retriesInlineUntilSuccessWithoutScheduling() {
        AtomicInteger attempts = new AtomicInteger();
        List<Duration> waits = new ArrayList<>();
        RecordingRetryPublisher publisher = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            OrderedPushRecordHandler handler = new OrderedPushRecordHandler(
                    pipeline,
                    request -> attempts.incrementAndGet() < 3
                            ? PushHttpResult.http(500, 1)
                            : PushHttpResult.http(204, 1),
                    publisher,
                    () -> true,
                    waits::add);

            assertThat(handler.handle(message(), subscription())).isTrue();
            assertThat(attempts).hasValue(3);
            assertThat(waits).containsExactly(
                    Duration.ofMillis(150), Duration.ofMillis(300));
            assertThat(publisher.scheduled).hasValue(0);
            assertThat(publisher.dlq).hasValue(0);
        }
    }

    @Test
    void writesDlqAfterFiniteInlineRetries() {
        RecordingRetryPublisher publisher = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            OrderedPushRecordHandler handler = new OrderedPushRecordHandler(
                    pipeline,
                    request -> PushHttpResult.http(503, 1),
                    publisher,
                    () -> true,
                    ignored -> {});

            assertThat(handler.handle(message(), subscription())).isTrue();
            assertThat(publisher.dlq).hasValue(1);
            assertThat(publisher.scheduled).hasValue(0);
        }
    }

    private static SubscriptionConfig subscription() {
        return new SubscriptionConfig(
                1,
                "settlement",
                "orders",
                "alice",
                true,
                Map.ofEntries(
                        Map.entry("mode", "PUSH"),
                        Map.entry("concurrency", 2),
                        Map.entry("maxTps", 100),
                        Map.entry("ordered", true),
                        Map.entry("orderKeySource", "KEY"),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "push",
                                Map.of(
                                        "urls", List.of("https://service.example/callback"),
                                        "method", "POST",
                                        "timeoutMs", 1_000,
                                        "retryIntervalsMs", List.of(150, 300)))));
    }

    private static PushMessage message() {
        return new PushMessage(
                "orders",
                0,
                1,
                Instant.EPOCH,
                "order-42",
                "{}".getBytes(StandardCharsets.UTF_8),
                List.of(),
                Map.of(),
                1);
    }

    private static final class RecordingRetryPublisher implements RetryPublisher {
        private final AtomicInteger scheduled = new AtomicInteger();
        private final AtomicInteger dlq = new AtomicInteger();

        @Override
        public void schedule(
                PushMessage message,
                String retryTopic,
                Instant dueAt,
                int nextRetryCount) {
            scheduled.incrementAndGet();
        }

        @Override
        public void publishDlq(PushMessage message, String dlqTopic, String reason) {
            dlq.incrementAndGet();
        }
    }
}
