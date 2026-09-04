package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class PushWorkerOrchestratorTest {
    @Test
    void startsReplacesAndStopsWorkersFromSubscriptionRevisions() {
        ConfigStore store = new ConfigStore();
        List<String> lifecycle = new ArrayList<>();
        PushWorkerFactory factory = subscription ->
                new FakeWorker(subscription.id(), lifecycle);
        try (PushWorkerOrchestrator orchestrator =
                new PushWorkerOrchestrator(store, factory)) {
            ConfigEvent first = event(1, true, "PUSH");
            assertThat(store.apply(first)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            orchestrator.onEvent(first);

            ConfigEvent changed = event(2, true, "PUSH");
            assertThat(store.apply(changed)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            orchestrator.onEvent(changed);

            ConfigEvent disabled = event(3, false, "PUSH");
            assertThat(store.apply(disabled)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            orchestrator.onEvent(disabled);

            ConfigEvent pull = event(4, true, "PULL");
            assertThat(store.apply(pull)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
            orchestrator.onEvent(pull);
            orchestrator.onDeleted(ConfigEntityType.SUBSCRIPTION, "1");

            assertThat(lifecycle)
                    .containsExactly("start-1", "close-1", "start-1", "close-1");
            assertThat(orchestrator.workerCount()).isZero();
            assertThat(orchestrator.configVersion("1")).isEqualTo(4);
        }
    }

    @Test
    void keepsLastKnownGoodWorkerWhenReplacementConstructionFails() {
        ConfigStore store = new ConfigStore();
        List<String> lifecycle = new ArrayList<>();
        PushWorkerFactory factory = subscription -> {
            if (subscription.spec().get("filterCel").equals("bad")) {
                throw new IllegalStateException("invalid replacement");
            }
            return new FakeWorker(subscription.id(), lifecycle);
        };
        try (PushWorkerOrchestrator orchestrator =
                new PushWorkerOrchestrator(store, factory)) {
            ConfigEvent first = event(1, true, "PUSH", "");
            store.apply(first);
            orchestrator.onEvent(first);

            ConfigEvent invalid = event(2, true, "PUSH", "bad");
            store.apply(invalid);
            orchestrator.onEvent(invalid);

            assertThat(lifecycle).containsExactly("start-1");
            assertThat(orchestrator.workerCount()).isOne();
            assertThat(orchestrator.lastError()).contains("IllegalStateException");
        }
        assertThat(lifecycle).containsExactly("start-1", "close-1");
    }

    private static ConfigEvent event(long version, boolean enabled, String mode) {
        return event(version, enabled, mode, "");
    }

    private static ConfigEvent event(
            long version, boolean enabled, String mode, String filterCel) {
        Map<String, Object> spec = "PULL".equals(mode)
                ? Map.of(
                        "mode", "PULL",
                        "concurrency", 2,
                        "maxTps", 100,
                        "ordered", false,
                        "pull", Map.of("maxBatch", 2, "ackTimeoutMs", 30_000))
                : Map.ofEntries(
                        Map.entry("mode", "PUSH"),
                        Map.entry("filterCel", filterCel),
                        Map.entry("concurrency", 2),
                        Map.entry("maxTps", 100),
                        Map.entry("ordered", false),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "push",
                                Map.of(
                                        "urls", List.of("https://example.test"),
                                        "method", "POST",
                                        "timeoutMs", 1_000,
                                        "retryIntervalsMs", List.of(150))));
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
                        "spec", spec));
    }

    private static final class FakeWorker implements PushSubscriptionWorker {
        private final long id;
        private final List<String> lifecycle;
        private boolean running;

        private FakeWorker(long id, List<String> lifecycle) {
            this.id = id;
            this.lifecycle = lifecycle;
        }

        @Override
        public void start() {
            running = true;
            lifecycle.add("start-" + id);
        }

        @Override
        public boolean running() {
            return running;
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
            if (running) {
                lifecycle.add("close-" + id);
                running = false;
            }
        }
    }
}
