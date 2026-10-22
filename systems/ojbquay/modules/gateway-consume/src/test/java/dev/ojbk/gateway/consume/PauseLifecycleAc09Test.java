package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

final class PauseLifecycleAc09Test {
    @Test
    void AC_09_failedStopDoesNotEraseWorkerOrConfirmRevision() {
        ConfigStore store = new ConfigStore();
        PushSubscriptionWorker worker = new PushSubscriptionWorker() {
            public void start() {}
            public boolean running() { return true; }
            public Optional<String> lastError() { return Optional.empty(); }
            public long acceptedCount() { return 0; }
            public void close() { throw new IllegalStateException("still running"); }
        };
        PushWorkerOrchestrator orchestrator = new PushWorkerOrchestrator(store, sub -> worker);
        ConfigEvent enabled = event(1, true);
        assertThat(store.apply(enabled)).isEqualTo(ConfigStore.ApplyResult.APPLIED); orchestrator.onEvent(enabled);
        ConfigEvent paused = event(2, false);
        store.apply(paused);
        orchestrator.onEvent(paused);
        assertThat(orchestrator.lastError()).contains("IllegalStateException");
        assertThat(orchestrator.workerCount()).isEqualTo(1);
        assertThat(orchestrator.configVersion("1")).isEqualTo(1);
    }

    @Test
    void AC_09_shutdownSettlesRemovedQueuedFuture() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        BoundedStripedExecutor stripes = new BoundedStripedExecutor(1, 2);
        try {
            stripes.submit("key", () -> { started.countDown(); release.await(); return true; });
            assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
            var queued = stripes.submit("key", () -> true);
            stripes.close();
            assertThat(queued.isDone()).isTrue();
        } finally { release.countDown(); stripes.close(); }
    }

    @Test
    void AC_09_bootstrapNeverStartsHistoricalEnabledRevision() {
        ConfigStore store = new ConfigStore();
        java.util.concurrent.atomic.AtomicBoolean bootstrapped = new java.util.concurrent.atomic.AtomicBoolean();
        java.util.concurrent.atomic.AtomicInteger starts = new java.util.concurrent.atomic.AtomicInteger();
        PushWorkerOrchestrator orchestrator = new PushWorkerOrchestrator(store, sub -> {
            starts.incrementAndGet(); throw new AssertionError("historical worker started");
        }, null, bootstrapped::get);
        ConfigEvent enabled = event(1, true); store.apply(enabled); orchestrator.onEvent(enabled);
        ConfigEvent paused = event(2, false); store.apply(paused); orchestrator.onEvent(paused);
        assertThat(orchestrator.pauseStatus("one", "boot", "roster", 1).fetchStopped()).isFalse();
        bootstrapped.set(true); orchestrator.reconcileAll();
        assertThat(starts.get()).isZero();
        var status = orchestrator.pauseStatus("one", "boot", "roster", 1);
        assertThat(status.revision()).isEqualTo(2);
        assertThat(status.fetchStopped()).isTrue();
        assertThat(status.inflightSettled()).isTrue();
        orchestrator.close();
    }

    @Test
    void AC_09_failedStartWithFailedCleanupCannotBecomePauseConfirmation() {
        ConfigStore store = new ConfigStore();
        PushSubscriptionWorker worker = new PushSubscriptionWorker() {
            public void start() { throw new IllegalStateException("partially started"); }
            public boolean running() { return true; }
            public Optional<String> lastError() { return Optional.empty(); }
            public long acceptedCount() { return 0; }
            public void close() { throw new IllegalStateException("still running"); }
        };
        PushWorkerOrchestrator orchestrator = new PushWorkerOrchestrator(store, sub -> worker);
        ConfigEvent enabled = event(1, true); store.apply(enabled); orchestrator.onEvent(enabled);
        ConfigEvent paused = event(2, false); store.apply(paused);
        try { orchestrator.onEvent(paused); } catch (IllegalStateException expected) { }
        assertThat(orchestrator.pauseStatus("one", "boot", "roster", 1).fetchStopped()).isFalse();
        assertThat(orchestrator.workerCount()).isEqualTo(1);
    }

    private static ConfigEvent event(long version, boolean enabled) {
        return new ConfigEvent(1, ConfigEntityType.SUBSCRIPTION, "1", version, Instant.EPOCH,
                "test", Map.of("id", 1, "group", "group", "topic", "orders", "owner", "test",
                "enabled", enabled, "spec", Map.of("mode", "PUSH", "concurrency", 1, "maxTps", 100, "ordered", false,
                        "push", Map.of("urls", java.util.List.of("http://example.test"),
                        "method", "POST", "timeoutMs", 1000, "retryIntervalsMs", java.util.List.of(150)))));
    }
}
