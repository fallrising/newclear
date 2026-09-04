package dev.ojbk.gateway.consume;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

public final class ConsumeMetrics {
    private final Map<String, Map<String, LongAdder>> push = new ConcurrentHashMap<>();
    private final Map<String, Map<String, LongAdder>> retries = new ConcurrentHashMap<>();
    private final Map<String, LongAdder> dlq = new ConcurrentHashMap<>();
    private final Map<String, LongAdder> latencyNanos = new ConcurrentHashMap<>();
    private final Map<String, LongAdder> latencyCount = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> versions = new ConcurrentHashMap<>();
    private final Map<String, AtomicInteger> pullInflight = new ConcurrentHashMap<>();
    private final AtomicInteger activeWorkers = new AtomicInteger();

    void recordPush(long subscriptionId, String code, long startedNanos) {
        String id = Long.toString(subscriptionId);
        push.computeIfAbsent(id, ignored -> new ConcurrentHashMap<>())
                .computeIfAbsent(code, ignored -> new LongAdder())
                .increment();
        latencyNanos.computeIfAbsent(id, ignored -> new LongAdder())
                .add(Math.max(0, System.nanoTime() - startedNanos));
        latencyCount.computeIfAbsent(id, ignored -> new LongAdder()).increment();
    }

    void recordRetry(long subscriptionId, int stage) {
        retries.computeIfAbsent(
                        Long.toString(subscriptionId),
                        ignored -> new ConcurrentHashMap<>())
                .computeIfAbsent(Integer.toString(stage), ignored -> new LongAdder())
                .increment();
    }

    void recordDlq(long subscriptionId) {
        dlq.computeIfAbsent(Long.toString(subscriptionId), ignored -> new LongAdder())
                .increment();
    }

    void setVersion(String subscriptionId, long version) {
        versions.computeIfAbsent(subscriptionId, ignored -> new AtomicLong())
                .set(version);
    }

    void setActiveWorkers(int count) {
        activeWorkers.set(Math.max(0, count));
    }

    void setPullInflight(String subscriptionId, int count) {
        pullInflight
                .computeIfAbsent(subscriptionId, ignored -> new AtomicInteger())
                .set(Math.max(0, count));
    }

    public String scrape() {
        StringBuilder output = new StringBuilder(2_048);
        output.append("# TYPE ojbk_push_workers gauge\n")
                .append("ojbk_push_workers ")
                .append(activeWorkers.get())
                .append('\n')
                .append("# TYPE ojbk_push_total counter\n");
        push.keySet().stream().sorted().forEach(id -> push.get(id).keySet().stream()
                .sorted()
                .forEach(code -> output.append("ojbk_push_total{sub=\"")
                        .append(label(id))
                        .append("\",code=\"")
                        .append(label(code))
                        .append("\"} ")
                        .append(push.get(id).get(code).sum())
                        .append('\n')));
        output.append("# TYPE ojbk_push_latency_seconds summary\n");
        latencyCount.keySet().stream().sorted().forEach(id -> {
            output.append("ojbk_push_latency_seconds_count{sub=\"")
                    .append(label(id))
                    .append("\"} ")
                    .append(latencyCount.get(id).sum())
                    .append('\n')
                    .append("ojbk_push_latency_seconds_sum{sub=\"")
                    .append(label(id))
                    .append("\"} ")
                    .append(latencyNanos.get(id).sum() / 1_000_000_000.0)
                    .append('\n');
        });
        output.append("# TYPE ojbk_deliver_retry_total counter\n");
        retries.keySet().stream().sorted().forEach(id -> retries.get(id).keySet().stream()
                .sorted()
                .forEach(stage -> output.append("ojbk_deliver_retry_total{sub=\"")
                        .append(label(id))
                        .append("\",stage=\"")
                        .append(label(stage))
                        .append("\"} ")
                        .append(retries.get(id).get(stage).sum())
                        .append('\n')));
        output.append("# TYPE ojbk_dlq_total counter\n");
        dlq.keySet().stream().sorted().forEach(id -> output.append("ojbk_dlq_total{sub=\"")
                .append(label(id))
                .append("\"} ")
                .append(dlq.get(id).sum())
                .append('\n'));
        output.append("# TYPE ojbk_sub_config_version gauge\n");
        versions.keySet().stream().sorted().forEach(id -> output
                .append("ojbk_sub_config_version{sub=\"")
                .append(label(id))
                .append("\"} ")
                .append(versions.get(id).get())
                .append('\n'));
        output.append("# TYPE ojbk_pull_inflight gauge\n");
        pullInflight.keySet().stream().sorted().forEach(id -> output
                .append("ojbk_pull_inflight{sub=\"")
                .append(label(id))
                .append("\"} ")
                .append(pullInflight.get(id).get())
                .append('\n'));
        return output.toString();
    }

    private static String label(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n");
    }
}
