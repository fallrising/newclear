package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.apache.kafka.clients.consumer.AcknowledgeType;
import org.junit.jupiter.api.Test;

final class PushRecordHandlerTest {
    private static final Instant NOW = Instant.parse("2026-07-29T12:00:00Z");

    @Test
    void schedulesConfiguredRetryBeforeAcceptingFailedSource() {
        RecordingRetryPublisher retry = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            PushRecordHandler handler = handler(pipeline, failedHttp(), retry);

            AcknowledgeType acknowledgement =
                    handler.handle(message(Map.of("x-ojbk-retry", "0")), subscription());

            assertThat(acknowledgement).isEqualTo(AcknowledgeType.ACCEPT);
            assertThat(retry.scheduled)
                    .containsExactly(new Scheduled(
                            "orders.settlement.retry",
                            NOW.plusMillis(150),
                            1));
            assertThat(retry.dlq).isEmpty();
        }
    }

    @Test
    void writesExhaustedAndPipelineFailuresToDlqBeforeAccept() {
        RecordingRetryPublisher retry = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            PushRecordHandler handler = handler(pipeline, failedHttp(), retry);

            assertThat(handler.handle(
                            message(Map.of("x-ojbk-retry", "3")), subscription()))
                    .isEqualTo(AcknowledgeType.ACCEPT);
            assertThat(handler.handle(
                            message(Map.of(), "not-json"), subscriptionWithTransit()))
                    .isEqualTo(AcknowledgeType.ACCEPT);

            assertThat(retry.dlq)
                    .containsExactly(
                            "orders.settlement.dlq",
                            "orders.settlement.dlq");
        }
    }

    @Test
    void releasesRecordWhenDurableHandoffFails() {
        RetryPublisher unavailable = new RetryPublisher() {
            @Override
            public void schedule(
                    PushMessage message,
                    String retryTopic,
                    Instant dueAt,
                    int nextRetryCount) {
                throw new IllegalStateException("Kafka unavailable");
            }

            @Override
            public void publishDlq(
                    PushMessage message, String dlqTopic, String reason) {
                throw new IllegalStateException("Kafka unavailable");
            }
        };
        try (PushPipeline pipeline = new PushPipeline()) {
            PushRecordHandler handler = handler(pipeline, failedHttp(), unavailable);

            assertThat(handler.handle(message(Map.of()), subscription()))
                    .isEqualTo(AcknowledgeType.RELEASE);
            assertThat(handler.handle(
                            message(Map.of("x-ojbk-retry", "3")), subscription()))
                    .isEqualTo(AcknowledgeType.RELEASE);
        }
    }

    @Test
    void acceptsFilterAndSuccessWithoutRetryIo() {
        RecordingRetryPublisher retry = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            PushRecordHandler successful =
                    handler(pipeline, request -> PushHttpResult.http(204, 1), retry);
            assertThat(successful.handle(message(Map.of()), subscription()))
                    .isEqualTo(AcknowledgeType.ACCEPT);

            SubscriptionConfig filteredSubscription = subscription(
                    spec(Map.of("tags", List.of("required"))));
            assertThat(successful.handle(message(Map.of()), filteredSubscription))
                    .isEqualTo(AcknowledgeType.ACCEPT);

            assertThat(retry.scheduled).isEmpty();
            assertThat(retry.dlq).isEmpty();
        }
    }

    @Test
    void releasesWithoutHttpWhenRateWaitIsInterrupted() {
        RecordingRetryPublisher retry = new RecordingRetryPublisher();
        try (PushPipeline pipeline = new PushPipeline()) {
            int[] calls = {0};
            PushRecordHandler handler = new PushRecordHandler(
                    pipeline,
                    request -> {
                        calls[0]++;
                        return PushHttpResult.http(204, 1);
                    },
                    retry,
                    Clock.fixed(NOW, ZoneOffset.UTC),
                    () -> false);

            assertThat(handler.handle(message(Map.of()), subscription()))
                    .isEqualTo(AcknowledgeType.RELEASE);
            assertThat(calls).containsExactly(0);
        }
    }

    private static PushRecordHandler handler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retry) {
        return new PushRecordHandler(
                pipeline,
                http,
                retry,
                Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private static PushHttpClient failedHttp() {
        return request -> PushHttpResult.http(500, 1);
    }

    private static SubscriptionConfig subscription() {
        return subscription(spec(Map.of()));
    }

    private static SubscriptionConfig subscriptionWithTransit() {
        return subscription(spec(Map.of("transit", Map.of("$.uid", "$.user.id"))));
    }

    private static SubscriptionConfig subscription(Map<String, Object> spec) {
        return new SubscriptionConfig(
                1, "settlement", "orders", "alice", true, spec);
    }

    private static Map<String, Object> spec(Map<String, Object> overrides) {
        Map<String, Object> spec = new java.util.HashMap<>(Map.ofEntries(
                Map.entry("mode", "PUSH"),
                Map.entry("concurrency", 8),
                Map.entry("maxTps", 100),
                Map.entry("ordered", false),
                Map.entry("dlqEnabled", true),
                Map.entry(
                        "push",
                        Map.of(
                                "urls", List.of("https://service.example/callback"),
                                "method", "POST",
                                "timeoutMs", 5_000,
                                "retryIntervalsMs", List.of(150, 300, 600)))));
        spec.putAll(overrides);
        return Map.copyOf(spec);
    }

    private static PushMessage message(Map<String, String> headers) {
        return message(headers, "{\"amount\":150}");
    }

    private static PushMessage message(
            Map<String, String> headers, String value) {
        return new PushMessage(
                "orders",
                1,
                42,
                NOW,
                "order-42",
                value.getBytes(StandardCharsets.UTF_8),
                List.of(),
                headers,
                1);
    }

    private static final class RecordingRetryPublisher implements RetryPublisher {
        private final List<Scheduled> scheduled = new ArrayList<>();
        private final List<String> dlq = new ArrayList<>();

        @Override
        public void schedule(
                PushMessage message,
                String retryTopic,
                Instant dueAt,
                int nextRetryCount) {
            scheduled.add(new Scheduled(retryTopic, dueAt, nextRetryCount));
        }

        @Override
        public void publishDlq(
                PushMessage message, String dlqTopic, String reason) {
            dlq.add(dlqTopic);
        }
    }

    private record Scheduled(
            String retryTopic, Instant dueAt, int nextRetryCount) {}
}
