package dev.ojbk.gateway.consume;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.SubscriptionConfig;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

public final class PushWorkerOrchestrator implements AutoCloseable {
    private final ConfigStore store;
    private final PushWorkerFactory factory;
    private final ConsumeMetrics metrics;
    private final Map<String, ManagedWorker> workers = new HashMap<>();
    private final Map<String, Long> versions = new HashMap<>();
    private final AtomicReference<String> lastError = new AtomicReference<>();

    public PushWorkerOrchestrator(ConfigStore store, PushWorkerFactory factory) {
        this(store, factory, null);
    }

    public PushWorkerOrchestrator(
            ConfigStore store, PushWorkerFactory factory, ConsumeMetrics metrics) {
        this.store = java.util.Objects.requireNonNull(store, "store");
        this.factory = java.util.Objects.requireNonNull(factory, "factory");
        this.metrics = metrics;
    }

    public synchronized void reconcileAll() {
        store.snapshot().entrySet().stream()
                .filter(entry ->
                        entry.getKey().type() == ConfigEntityType.SUBSCRIPTION)
                .map(Map.Entry::getValue)
                .sorted(java.util.Comparator.comparingLong(ConfigEvent::version))
                .forEach(this::onEvent);
    }

    public synchronized void onEvent(ConfigEvent event) {
        if (event.entityType() != ConfigEntityType.SUBSCRIPTION) {
            return;
        }
        Long knownVersion = versions.get(event.entityId());
        if (knownVersion != null && knownVersion >= event.version()) {
            return;
        }
        versions.put(event.entityId(), event.version());
        if (metrics != null) {
            metrics.setVersion(event.entityId(), event.version());
        }
        Optional<SubscriptionConfig> current = store.subscription(event.entityId());
        if (current.isEmpty()
                || !isEnabledPush(current.orElseThrow())) {
            stop(event.entityId());
            return;
        }

        PushSubscriptionWorker replacement;
        try {
            replacement = factory.create(current.orElseThrow());
        } catch (RuntimeException failure) {
            lastError.set(failure.getClass().getSimpleName());
            return;
        }

        stop(event.entityId());
        try {
            replacement.start();
            workers.put(
                    event.entityId(), new ManagedWorker(event.version(), replacement));
            updateWorkerGauge();
            lastError.set(null);
        } catch (RuntimeException failure) {
            try {
                replacement.close();
            } catch (RuntimeException closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            lastError.set(failure.getClass().getSimpleName());
        }
    }

    public synchronized void onDeleted(ConfigEntityType type, String entityId) {
        if (type == ConfigEntityType.SUBSCRIPTION) {
            stop(entityId);
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

    public Optional<String> lastError() {
        String ownError = lastError.get();
        if (ownError != null) {
            return Optional.of(ownError);
        }
        synchronized (this) {
            return workers.values().stream()
                    .map(ManagedWorker::worker)
                    .map(PushSubscriptionWorker::lastError)
                    .flatMap(Optional::stream)
                    .findFirst();
        }
    }

    private static boolean isEnabledPush(SubscriptionConfig subscription) {
        return subscription.enabled() && "PUSH".equals(subscription.spec().get("mode"));
    }

    private void stop(String entityId) {
        ManagedWorker existing = workers.remove(entityId);
        if (existing != null) {
            existing.worker().close();
            updateWorkerGauge();
        }
    }

    @Override
    public synchronized void close() {
        workers.values().forEach(worker -> worker.worker().close());
        workers.clear();
        updateWorkerGauge();
    }

    private void updateWorkerGauge() {
        if (metrics != null) {
            metrics.setActiveWorkers(workers.size());
        }
    }

    private record ManagedWorker(long version, PushSubscriptionWorker worker) {}
}
