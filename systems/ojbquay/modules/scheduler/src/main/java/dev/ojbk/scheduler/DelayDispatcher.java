package dev.ojbk.scheduler;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public final class DelayDispatcher {
    private final DelayRepository repository;
    private final DelaySender sender;
    private final SchedulerMetrics metrics;
    private final int batchSize;

    public DelayDispatcher(DelayRepository repository, DelaySender sender) {
        this(repository, sender, new SchedulerMetrics(), JdbcDelayRepository.MAX_BATCH);
    }

    DelayDispatcher(
            DelayRepository repository,
            DelaySender sender,
            SchedulerMetrics metrics,
            int batchSize) {
        this.repository = Objects.requireNonNull(repository, "repository");
        this.sender = Objects.requireNonNull(sender, "sender");
        this.metrics = Objects.requireNonNull(metrics, "metrics");
        if (batchSize < 1 || batchSize > JdbcDelayRepository.MAX_BATCH) {
            throw new IllegalArgumentException("dispatcher batch size must be 1..500");
        }
        this.batchSize = batchSize;
    }

    public int tick(Instant now) {
        try {
            return repository.dispatchDue(now, batchSize, delivery -> {
                try {
                    sender.send(delivery);
                    metrics.recordFired(Duration.between(delivery.dueAt(), now));
                } catch (RuntimeException failure) {
                    metrics.recordFireFailure();
                    throw failure;
                }
            });
        } catch (RuntimeException failure) {
            metrics.recordFailure();
            throw failure;
        }
    }

    public int cleanup(Instant before) {
        try {
            return repository.cleanupTerminal(before, batchSize);
        } catch (RuntimeException failure) {
            metrics.recordFailure();
            throw failure;
        }
    }

    public long refreshPending() {
        try {
            long count = repository.pendingCount();
            metrics.setPending(count);
            return count;
        } catch (RuntimeException failure) {
            metrics.recordFailure();
            throw failure;
        }
    }
}
