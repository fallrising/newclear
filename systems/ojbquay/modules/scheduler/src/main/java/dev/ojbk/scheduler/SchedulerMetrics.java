package dev.ojbk.scheduler;

import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

public final class SchedulerMetrics {
    private static final double[] LAG_BUCKETS = {0.1, 0.25, 0.5, 1.0, 5.0, 30.0};

    private final LongAdder ingested = new LongAdder();
    private final LongAdder fired = new LongAdder();
    private final LongAdder fireFailures = new LongAdder();
    private final LongAdder workerFailures = new LongAdder();
    private final LongAdder lagNanos = new LongAdder();
    private final LongAdder[] lagBuckets = buckets();
    private final AtomicLong pending = new AtomicLong();

    void recordIngested(int count) {
        ingested.add(count);
    }

    void recordFired(Duration lag) {
        long nanos = Math.max(0, lag.toNanos());
        fired.increment();
        lagNanos.add(nanos);
        double seconds = nanos / 1_000_000_000.0;
        for (int index = 0; index < LAG_BUCKETS.length; index++) {
            if (seconds <= LAG_BUCKETS[index]) {
                lagBuckets[index].increment();
            }
        }
    }

    void recordFireFailure() {
        fireFailures.increment();
    }

    void recordFailure() {
        workerFailures.increment();
    }

    void setPending(long count) {
        pending.set(Math.max(0, count));
    }

    public String scrape() {
        StringBuilder output = new StringBuilder(1_024);
        output.append("# TYPE ojbk_delay_pending gauge\n")
                .append("ojbk_delay_pending ")
                .append(pending.get())
                .append('\n')
                .append("# TYPE ojbk_delay_ingested_total counter\n")
                .append("ojbk_delay_ingested_total ")
                .append(ingested.sum())
                .append('\n')
                .append("# TYPE ojbk_delay_fired_total counter\n")
                .append("ojbk_delay_fired_total{result=\"success\"} ")
                .append(fired.sum())
                .append('\n')
                .append("ojbk_delay_fired_total{result=\"failure\"} ")
                .append(fireFailures.sum())
                .append('\n')
                .append("# TYPE ojbk_delay_fire_lag_seconds histogram\n");
        for (int index = 0; index < LAG_BUCKETS.length; index++) {
            output.append("ojbk_delay_fire_lag_seconds_bucket{le=\"")
                    .append(String.format(Locale.ROOT, "%.2f", LAG_BUCKETS[index]))
                    .append("\"} ")
                    .append(lagBuckets[index].sum())
                    .append('\n');
        }
        output.append("ojbk_delay_fire_lag_seconds_bucket{le=\"+Inf\"} ")
                .append(fired.sum())
                .append('\n')
                .append("ojbk_delay_fire_lag_seconds_count ")
                .append(fired.sum())
                .append('\n')
                .append("ojbk_delay_fire_lag_seconds_sum ")
                .append(String.format(
                        Locale.ROOT, "%.9f", lagNanos.sum() / 1_000_000_000.0))
                .append('\n')
                .append("# TYPE ojbk_delay_worker_failures_total counter\n")
                .append("ojbk_delay_worker_failures_total ")
                .append(workerFailures.sum())
                .append('\n');
        return output.toString();
    }

    private static LongAdder[] buckets() {
        LongAdder[] buckets = new LongAdder[LAG_BUCKETS.length];
        for (int index = 0; index < buckets.length; index++) {
            buckets[index] = new LongAdder();
        }
        return buckets;
    }
}
