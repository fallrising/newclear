package dev.ojbk.gateway.produce;

import ojbk.v1.Code;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;

public final class ProducerMetrics {
    private static final int MAX_SERIES = 20_000;
    private final Map<Series, LongAdder> totals =
            new LinkedHashMap<>(256, 0.75f, true);
    private final LongAdder bytes = new LongAdder();
    private final LongAdder latencyCount = new LongAdder();
    private final LongAdder latencyNanos = new LongAdder();

    public synchronized void record(
            String topic, Code code, int valueBytes, long latencyNanos) {
        Series series = new Series(safeTopic(topic), code);
        totals.computeIfAbsent(series, ignored -> new LongAdder()).increment();
        while (totals.size() > MAX_SERIES) {
            totals.remove(totals.keySet().iterator().next());
        }
        if (code == Code.OK) {
            bytes.add(Math.max(0, valueBytes));
        }
        latencyCount.increment();
        this.latencyNanos.add(Math.max(0, latencyNanos));
    }

    public synchronized String scrape() {
        StringBuilder output = new StringBuilder(1_024);
        output.append("# TYPE ojbk_produce_total counter\n");
        totals.forEach((series, count) -> output.append("ojbk_produce_total{topic=\"")
                .append(escape(series.topic()))
                .append("\",code=\"")
                .append(series.code().name())
                .append("\"} ")
                .append(count.sum())
                .append('\n'));
        output.append("# TYPE ojbk_produce_bytes_total counter\n")
                .append("ojbk_produce_bytes_total ")
                .append(bytes.sum())
                .append('\n')
                .append("# TYPE ojbk_produce_latency_seconds summary\n")
                .append("ojbk_produce_latency_seconds_count ")
                .append(latencyCount.sum())
                .append('\n')
                .append("ojbk_produce_latency_seconds_sum ")
                .append(String.format(
                        Locale.ROOT, "%.9f", latencyNanos.sum() / 1_000_000_000.0))
                .append('\n');
        return output.toString();
    }

    private static String safeTopic(String topic) {
        return topic == null || topic.isBlank() ? "_invalid" : topic;
    }

    private static String escape(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private record Series(String topic, Code code) {}
}
