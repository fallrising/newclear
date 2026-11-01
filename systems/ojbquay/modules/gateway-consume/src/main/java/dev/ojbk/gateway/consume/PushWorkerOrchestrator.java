package dev.ojbk.gateway.consume;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.SubscriptionConfig;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

public final class PushWorkerOrchestrator implements AutoCloseable {
    private final ConfigStore store;
    private final PushWorkerFactory factory;
    private final ConsumeMetrics metrics;
    private final java.util.function.BooleanSupplier bootstrapComplete;
    private final Map<String, ManagedWorker> workers = new HashMap<>();
    private final Map<String, Long> versions = new HashMap<>();
    private final Map<String, String> failures = new HashMap<>();
    private ScheduledExecutorService reconciler;
    private String reconcileFailure;
    private boolean closing;

    public PushWorkerOrchestrator(ConfigStore store, PushWorkerFactory factory) {
        this(store, factory, null);
    }

    public PushWorkerOrchestrator(
            ConfigStore store, PushWorkerFactory factory, ConsumeMetrics metrics) {
        this(store, factory, metrics, () -> true);
    }

    public PushWorkerOrchestrator(ConfigStore store, PushWorkerFactory factory,
            ConsumeMetrics metrics, java.util.function.BooleanSupplier bootstrapComplete) {
        this.bootstrapComplete = java.util.Objects.requireNonNull(bootstrapComplete);
        this.store = java.util.Objects.requireNonNull(store, "store");
        this.factory = java.util.Objects.requireNonNull(factory, "factory");
        this.metrics = metrics;
    }

    /** One fixed-delay task: no per-event queue and no worker shutdown on the broker poll thread. */
    public synchronized void startReconciliation() {
        if (closing || reconciler != null) throw new IllegalStateException("reconciler cannot be started twice");
        reconciler = Executors.newSingleThreadScheduledExecutor(
                Thread.ofPlatform().daemon().name("ojbquay-push-reconcile").factory());
        reconciler.scheduleWithFixedDelay(this::reconcileScheduled, 0, 250, TimeUnit.MILLISECONDS);
    }

    // A throwing fixed-delay task is cancelled for good; record the failure and keep the schedule alive.
    private synchronized void reconcileScheduled() {
        try {
            reconcileAll();
            reconcileFailure = null;
        } catch (RuntimeException failure) {
            reconcileFailure = failure.getClass().getSimpleName();
        }
    }

    public synchronized void reconcileAll() {
        if (closing) return;
        if (!bootstrapComplete.getAsBoolean()) {
            retryPendingStops();
            return;
        }
        // Tombstones no longer appear in the store; retained workers still need stop retries.
        var known = new java.util.HashSet<>(workers.keySet());
        known.addAll(versions.keySet());
        for (String id : known) {
            if (store.get(ConfigEntityType.SUBSCRIPTION, id).isEmpty())
                onDeleted(ConfigEntityType.SUBSCRIPTION, id);
        }
        store.snapshot().entrySet().stream()
                .filter(entry ->
                        entry.getKey().type() == ConfigEntityType.SUBSCRIPTION)
                .map(Map.Entry::getValue)
                .sorted(java.util.Comparator.comparingLong(ConfigEvent::version))
                .forEach(this::onEvent);
    }

    // Without a live config bus only stopping is safe: never start, replace or record a revision.
    private void retryPendingStops() {
        for (String id : java.util.List.copyOf(workers.keySet())) {
            if (store.subscription(id).filter(PushWorkerOrchestrator::isEnabledPush).isPresent()) continue;
            try { stop(id); }
            catch (RuntimeException failure) { failures.put(id, failure.getClass().getSimpleName()); }
        }
    }

    public synchronized void onEvent(ConfigEvent event) {
        if (closing) return;
        try { applyEvent(event); }
        catch (RuntimeException failure) { failures.put(event.entityId(), failure.getClass().getSimpleName()); }
    }

    private void applyEvent(ConfigEvent event) {
        if (!bootstrapComplete.getAsBoolean()
                || event.entityType() != ConfigEntityType.SUBSCRIPTION) {
            return;
        }
        Long knownVersion = versions.get(event.entityId());
        if (knownVersion != null && knownVersion >= event.version()) {
            return;
        }
        Optional<SubscriptionConfig> current = store.subscription(event.entityId());
        if (current.isEmpty()
                || !isEnabledPush(current.orElseThrow())) {
            stop(event.entityId());
            recordVersion(event);
            return;
        }

        PushSubscriptionWorker replacement;
        try {
            replacement = factory.create(current.orElseThrow());
        } catch (RuntimeException failure) {
            failures.put(event.entityId(), failure.getClass().getSimpleName());
            return;
        }

        try {
            stop(event.entityId());
        } catch (RuntimeException stopFailure) {
            try { replacement.close(); }
            catch (RuntimeException closeFailure) { stopFailure.addSuppressed(closeFailure); }
            throw stopFailure;
        }
        // Track before start: a partial start followed by failed cleanup is still inflight.
        workers.put(event.entityId(), new ManagedWorker(event.version(), replacement));
        try {
            replacement.start();
            updateWorkerGauge();
            recordVersion(event);
            failures.remove(event.entityId());
        } catch (RuntimeException failure) {
            try {
                replacement.close();
                workers.remove(event.entityId());
                updateWorkerGauge();
            } catch (RuntimeException closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            failures.put(event.entityId(), failure.getClass().getSimpleName());
        }
    }

    public synchronized void onDeleted(ConfigEntityType type, String entityId) {
        if (type == ConfigEntityType.SUBSCRIPTION) {
            try {
                stop(entityId);
                // Forget the revision only once the store holds the tombstone; a premature callback keeps it.
                if (store.get(ConfigEntityType.SUBSCRIPTION, entityId).isEmpty()) versions.remove(entityId);
                failures.remove(entityId);
            } catch (RuntimeException failure) {
                failures.put(entityId, failure.getClass().getSimpleName());
            }
        }
    }

    public synchronized int workerCount() {
        return workers.size();
    }

    public synchronized long acceptedCount() {
        return workers.values().stream()
                .mapToLong(worker -> worker.worker().acceptedCount())
                .sum();
    }

    public synchronized long configVersion(String entityId) {
        return versions.getOrDefault(entityId, 0L);
    }

    public synchronized Map<String, Long> configVersions() {
        return Map.copyOf(versions);
    }

    public synchronized Optional<String> lastError() {
        if (reconcileFailure != null) return Optional.of(reconcileFailure);
        return failures.values().stream().findFirst().or(() -> workers.values().stream()
                .map(ManagedWorker::worker).map(PushSubscriptionWorker::lastError)
                .flatMap(Optional::stream).findFirst());
    }

    private void recordVersion(ConfigEvent event) {
        versions.put(event.entityId(), event.version());
        failures.remove(event.entityId());
        if (metrics != null) metrics.setVersion(event.entityId(), event.version());
    }

    public synchronized dev.ojbk.config.RuntimePauseStatus pauseStatus(
            String instance, String boot, String roster, long subscriptionId) {
        String id = Long.toString(subscriptionId);
        var event = store.get(ConfigEntityType.SUBSCRIPTION, id);
        boolean paused = store.subscription(id).map(s -> !s.enabled()).orElse(false);
        long revision = event.map(ConfigEvent::version).orElse(0L);
        boolean stopped = bootstrapComplete.getAsBoolean() && paused
                && versions.getOrDefault(id, 0L) == revision && !workers.containsKey(id);
        return new dev.ojbk.config.RuntimePauseStatus(instance, boot, roster, subscriptionId,
                revision, paused, stopped, stopped, bootstrapComplete.getAsBoolean());
    }

    private static boolean isEnabledPush(SubscriptionConfig subscription) {
        return subscription.enabled() && "PUSH".equals(subscription.spec().get("mode"));
    }

    private void stop(String entityId) {
        ManagedWorker existing = workers.get(entityId);
        if (existing != null) {
            existing.worker().close();
            workers.remove(entityId);
            updateWorkerGauge();
        }
    }

    @Override
    public void close() {
        ScheduledExecutorService active;
        synchronized (this) { closing = true; active = reconciler; }
        if (active != null) active.shutdownNow();
        RuntimeException failure = null;
        synchronized (this) {
            for (String id : java.util.List.copyOf(workers.keySet())) {
                try { stop(id); }
                catch (RuntimeException stopFailure) {
                    failures.put(id, stopFailure.getClass().getSimpleName());
                    if (failure == null) failure = new IllegalStateException("push workers did not all terminate");
                    failure.addSuppressed(stopFailure);
                }
            }
            updateWorkerGauge();
        }
        if (active != null) {
            try {
                if (!active.awaitTermination(5, TimeUnit.SECONDS)) {
                    if (failure == null) failure = new IllegalStateException("push reconciler did not terminate");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                if (failure == null) failure = new IllegalStateException("push reconciler stop interrupted", interrupted);
            }
        }
        if (failure != null) throw failure;
    }

    private void updateWorkerGauge() {
        if (metrics != null) {
            metrics.setActiveWorkers(workers.size());
        }
    }

    private record ManagedWorker(long version, PushSubscriptionWorker worker) {}
}
