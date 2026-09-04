package dev.ojbk.gateway.consume;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;
import java.util.concurrent.atomic.AtomicReference;

final class PullWorkerRegistry implements PullGateway, AutoCloseable {
    private final ConfigStore store;
    private final PullWorkerFactory factory;
    private final Map<String, PullWorker> workers = new HashMap<>();
    private final Map<String, Long> versions = new HashMap<>();
    private final AtomicReference<String> lastError = new AtomicReference<>();

    PullWorkerRegistry(ConfigStore store, PullWorkerFactory factory) {
        this.store = java.util.Objects.requireNonNull(store, "store");
        this.factory = java.util.Objects.requireNonNull(factory, "factory");
    }

    synchronized void reconcileAll() {
        store.snapshot().entrySet().stream()
                .filter(entry ->
                        entry.getKey().type() == ConfigEntityType.SUBSCRIPTION)
                .map(Map.Entry::getValue)
                .sorted(java.util.Comparator.comparingLong(ConfigEvent::version))
                .forEach(this::onEvent);
    }

    synchronized void onEvent(ConfigEvent event) {
        if (event.entityType() != ConfigEntityType.SUBSCRIPTION) {
            return;
        }
        Long known = versions.get(event.entityId());
        if (known != null && known >= event.version()) {
            return;
        }
        versions.put(event.entityId(), event.version());
        SubscriptionConfig subscription =
                store.subscription(event.entityId()).orElse(null);
        if (subscription == null || !enabledPull(subscription)) {
            stop(event.entityId());
            return;
        }

        PullWorker replacement;
        try {
            replacement = factory.create(subscription);
        } catch (RuntimeException failure) {
            lastError.set(error(failure));
            return;
        }
        stop(event.entityId());
        try {
            replacement.start();
            workers.put(event.entityId(), replacement);
            lastError.set(null);
        } catch (RuntimeException failure) {
            replacement.close();
            lastError.set(error(failure));
        }
    }

    synchronized void onDeleted(ConfigEntityType type, String entityId) {
        if (type == ConfigEntityType.SUBSCRIPTION) {
            stop(entityId);
        }
    }

    @Override
    public PullPollResult poll(
            String group, String topic, int maxBatch, Duration linger) {
        PullWorker worker;
        synchronized (this) {
            worker = workers.values().stream()
                    .filter(candidate -> candidate.group().equals(group))
                    .filter(candidate -> candidate.topic().equals(topic))
                    .findFirst()
                    .orElse(null);
        }
        if (worker == null) {
            return PullPollResult.notFound();
        }
        try {
            return PullPollResult.ok(worker.pollBatch(maxBatch, linger));
        } catch (IllegalArgumentException invalid) {
            return PullPollResult.invalid(invalid.getMessage());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return PullPollResult.unavailable();
        } catch (IllegalStateException unavailable) {
            return PullPollResult.unavailable();
        }
    }

    @Override
    public PullAckResult acknowledge(
            String group,
            List<String> accepted,
            List<String> released,
            Duration timeout) {
        List<String> tokens = java.util.stream.Stream.concat(
                        accepted.stream(), released.stream())
                .toList();
        if (tokens.isEmpty()) {
            return PullAckResult.invalid("ack or nack token is required");
        }
        OptionalLong first = PullAckToken.subscriptionId(tokens.getFirst());
        if (first.isEmpty()
                || tokens.stream()
                        .map(PullAckToken::subscriptionId)
                        .anyMatch(value ->
                                value.isEmpty()
                                        || value.getAsLong() != first.getAsLong())) {
            return PullAckResult.invalid(
                    "acknowledgement tokens must belong to one subscription");
        }
        PullWorker worker;
        synchronized (this) {
            worker = workers.get(Long.toString(first.getAsLong()));
        }
        if (worker == null || !worker.group().equals(group)) {
            return PullAckResult.invalid(
                    "acknowledgement token is stale or unknown");
        }
        return worker.acknowledge(accepted, released, timeout);
    }

    synchronized int workerCount() {
        return workers.size();
    }

    synchronized long acceptedCount() {
        return workers.values().stream()
                .mapToLong(PullWorker::acceptedCount)
                .sum();
    }

    java.util.Optional<String> lastError() {
        return java.util.Optional.ofNullable(lastError.get());
    }

    private static boolean enabledPull(SubscriptionConfig subscription) {
        return subscription.enabled()
                && "PULL".equals(subscription.spec().get("mode"));
    }

    private synchronized void stop(String entityId) {
        PullWorker existing = workers.remove(entityId);
        if (existing != null) {
            existing.close();
        }
    }

    @Override
    public synchronized void close() {
        workers.values().forEach(PullWorker::close);
        workers.clear();
    }

    private static String error(RuntimeException failure) {
        return failure.getClass().getSimpleName()
                + ":"
                + String.valueOf(failure.getMessage());
    }
}
