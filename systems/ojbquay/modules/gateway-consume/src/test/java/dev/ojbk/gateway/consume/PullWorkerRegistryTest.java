package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class PullWorkerRegistryTest {
    @Test
    void startsRoutesAndStopsPullWorkersByRevision() {
        ConfigStore store = new ConfigStore();
        FakeWorker worker = new FakeWorker();
        try (PullWorkerRegistry registry =
                new PullWorkerRegistry(store, subscription -> worker)) {
            ConfigEvent enabled = event(1, true);
            assertThat(store.apply(enabled)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            registry.onEvent(enabled);

            PullPollResult poll = registry.poll(
                    "settlement", "orders", 1, Duration.ZERO);
            assertThat(poll.code()).isEqualTo(ojbk.v1.Code.OK);
            String token = poll.deliveries().getFirst().ackToken();
            assertThat(registry.acknowledge(
                                    "settlement",
                                    List.of(token),
                                    List.of(),
                                    Duration.ofSeconds(1))
                            .code())
                    .isEqualTo(ojbk.v1.Code.OK);

            ConfigEvent disabled = event(2, false);
            assertThat(store.apply(disabled)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            registry.onEvent(disabled);

            assertThat(registry.workerCount()).isZero();
            assertThat(worker.started).isTrue();
            assertThat(worker.closed).isTrue();
        }
    }

    @Test
    void rejectsTokensThatDoNotRouteToTheAuthenticatedGroup() {
        ConfigStore store = new ConfigStore();
        FakeWorker worker = new FakeWorker();
        try (PullWorkerRegistry registry =
                new PullWorkerRegistry(store, subscription -> worker)) {
            ConfigEvent enabled = event(1, true);
            store.apply(enabled);
            registry.onEvent(enabled);
            String token = registry.poll(
                            "settlement", "orders", 1, Duration.ZERO)
                    .deliveries()
                    .getFirst()
                    .ackToken();

            assertThat(registry.acknowledge(
                                    "another-group",
                                    List.of(token),
                                    List.of(),
                                    Duration.ofSeconds(1))
                            .code())
                    .isEqualTo(ojbk.v1.Code.INVALID_ARGUMENT);
            assertThat(registry.acknowledge(
                                    "settlement",
                                    List.of("not-a-token"),
                                    List.of(),
                                    Duration.ofSeconds(1))
                            .code())
                    .isEqualTo(ojbk.v1.Code.INVALID_ARGUMENT);
        }
    }

    private static ConfigEvent event(long version, boolean enabled) {
        return new ConfigEvent(
                1,
                ConfigEntityType.SUBSCRIPTION,
                "1",
                version,
                Instant.EPOCH.plusSeconds(version),
                "test",
                Map.of(
                        "id", 1,
                        "group", "settlement",
                        "topic", "orders",
                        "owner", "alice",
                        "enabled", enabled,
                        "spec", Map.of(
                                "mode", "PULL",
                                "concurrency", 4,
                                "maxTps", 100,
                                "ordered", false,
                                "pull", Map.of(
                                        "maxBatch", 4,
                                        "ackTimeoutMs", 30_000))));
    }

    private static final class FakeWorker implements PullWorker {
        private boolean started;
        private boolean closed;

        @Override
        public long subscriptionId() {
            return 1;
        }

        @Override
        public String group() {
            return "settlement";
        }

        @Override
        public String topic() {
            return "orders";
        }

        @Override
        public List<PullDelivery> pollBatch(int maximum, Duration linger) {
            return List.of(new PullDelivery(
                    "orders",
                    0,
                    42,
                    Instant.EPOCH,
                    "key",
                    new byte[] {1},
                    List.of(),
                    Map.of(),
                    PullAckToken.issue(
                            1, new PullRecordId("orders", 0, 42)),
                    1));
        }

        @Override
        public PullAckResult acknowledge(
                List<String> accepted,
                List<String> released,
                Duration timeout) {
            return PullAckResult.ok();
        }

        @Override
        public void start() {
            started = true;
        }

        @Override
        public boolean running() {
            return started && !closed;
        }

        @Override
        public Optional<String> lastError() {
            return Optional.empty();
        }

        @Override
        public long acceptedCount() {
            return 0;
        }

        @Override
        public void close() {
            closed = true;
        }
    }
}
