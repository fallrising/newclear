package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import ojbk.v1.Code;
import dev.ojbk.config.SubscriptionConfig;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

final class PullShareWorkerTest {
    @Test
    void commitsAckAndRedeliversNackWithANewTokenAndDeliveryCount() throws Exception {
        FakePullBroker broker = new FakePullBroker(List.of(
                record(0, "first", 1),
                record(1, "second", 1)));
        try (PushPipeline pipeline = new PushPipeline();
                PullShareWorker worker = new PullShareWorker(
                        broker,
                        subscription(),
                        pipeline,
                        (message, topic, reason) -> {},
                        Clock.fixed(Instant.parse("2026-07-29T12:00:00Z"), ZoneOffset.UTC))) {
            worker.start();

            List<PullDelivery> first = List.of(
                    worker.pollBatch(1, Duration.ofSeconds(2)).getFirst(),
                    worker.pollBatch(1, Duration.ofSeconds(2)).getFirst());

            PullAckResult result = worker.acknowledge(
                    List.of(first.get(0).ackToken()),
                    List.of(first.get(1).ackToken()),
                    Duration.ofSeconds(2));

            assertThat(result.code()).isEqualTo(Code.OK);
            assertThat(broker.awaitDisposition(
                            PullRecordId.from(first.get(0)), PullDisposition.ACCEPT))
                    .isTrue();
            assertThat(broker.awaitDisposition(
                            PullRecordId.from(first.get(1)), PullDisposition.RELEASE))
                    .isTrue();

            PullDelivery redelivered =
                    worker.pollBatch(1, Duration.ofSeconds(2)).getFirst();
            assertThat(redelivered.offset()).isEqualTo(first.get(1).offset());
            assertThat(redelivered.deliveryCount()).isEqualTo(2);
            assertThat(redelivered.ackToken()).isNotEqualTo(first.get(1).ackToken());
        }
    }

    @Test
    void rejectsAStaleTokenWithoutSettlingAnotherDelivery() throws Exception {
        FakePullBroker broker = new FakePullBroker(List.of(record(0, "first", 1)));
        try (PushPipeline pipeline = new PushPipeline();
                PullShareWorker worker = new PullShareWorker(
                        broker,
                        subscription(),
                        pipeline,
                        (message, topic, reason) -> {},
                        Clock.systemUTC())) {
            worker.start();
            PullDelivery delivery =
                    worker.pollBatch(1, Duration.ofSeconds(2)).getFirst();

            PullAckResult invalid = worker.acknowledge(
                    List.of("stale-token"),
                    List.of(),
                    Duration.ofSeconds(2));

            assertThat(invalid.code()).isEqualTo(Code.INVALID_ARGUMENT);
            assertThat(worker.inflightCount()).isEqualTo(1);
            assertThat(broker.hasTerminalDisposition(PullRecordId.from(delivery)))
                    .isFalse();
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
                        Map.entry("mode", "PULL"),
                        Map.entry("concurrency", 4),
                        Map.entry("maxTps", 1_000),
                        Map.entry("ordered", false),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "pull",
                                Map.of(
                                        "maxBatch", 4,
                                        "ackTimeoutMs", 30_000,
                                        "maxRetry", 3))));
    }

    private static PullBrokerRecord record(long offset, String value, int deliveryCount) {
        return new PullBrokerRecord(new PushMessage(
                "orders",
                0,
                offset,
                Instant.EPOCH,
                "key-" + offset,
                value.getBytes(StandardCharsets.UTF_8),
                List.of(),
                Map.of(),
                deliveryCount));
    }

    private static final class FakePullBroker implements PullBroker {
        private final ArrayDeque<List<PullBrokerRecord>> batches = new ArrayDeque<>();
        private final List<Map<PullRecordId, PullDisposition>> settlements =
                new ArrayList<>();
        private List<PullBrokerRecord> previous = List.of();

        private FakePullBroker(List<PullBrokerRecord> initial) {
            batches.add(initial);
        }

        @Override
        public synchronized List<PullBrokerRecord> poll(Duration timeout) {
            List<PullBrokerRecord> next = batches.poll();
            previous = next == null ? List.of() : next;
            return previous;
        }

        @Override
        public synchronized void settle(Map<PullRecordId, PullDisposition> dispositions) {
            assertThat(dispositions.keySet())
                    .containsExactlyInAnyOrderElementsOf(
                            previous.stream().map(PullBrokerRecord::id).toList());
            settlements.add(Map.copyOf(dispositions));
            List<PullBrokerRecord> next = new ArrayList<>();
            previous.forEach(record -> {
                PullDisposition disposition = dispositions.get(record.id());
                if (disposition == PullDisposition.RENEW) {
                    next.add(record);
                } else if (disposition == PullDisposition.RELEASE) {
                    PushMessage message = record.message();
                    next.add(new PullBrokerRecord(new PushMessage(
                            message.topic(),
                            message.partition(),
                            message.offset(),
                            message.timestamp(),
                            message.key(),
                            message.value(),
                            message.tags(),
                            message.headers(),
                            message.deliveryCount() + 1)));
                }
            });
            if (!next.isEmpty()) {
                batches.add(next);
            }
            previous = List.of();
        }

        @Override
        public void wakeup() {}

        @Override
        public void close() {}

        synchronized boolean awaitDisposition(
                PullRecordId id, PullDisposition expected) throws InterruptedException {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (System.nanoTime() < deadline) {
                if (settlements.stream()
                        .anyMatch(values -> values.get(id) == expected)) {
                    return true;
                }
                wait(10);
            }
            return false;
        }

        synchronized boolean hasTerminalDisposition(PullRecordId id) {
            return settlements.stream()
                    .map(values -> values.get(id))
                    .filter(java.util.Objects::nonNull)
                    .anyMatch(value -> value != PullDisposition.RENEW);
        }
    }
}
