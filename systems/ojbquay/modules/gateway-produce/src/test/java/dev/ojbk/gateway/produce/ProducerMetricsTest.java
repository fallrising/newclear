package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;

import ojbk.v1.Code;
import org.junit.jupiter.api.Test;

final class ProducerMetricsTest {

    @Test
    void rendersBoundedPrometheusCountersWithoutPayloadOrTokenData() {
        ProducerMetrics metrics = new ProducerMetrics();
        metrics.record("orders", Code.OK, 12, 2_000_000);
        metrics.record("orders", Code.AUTH_FAILED, 99, 1_000_000);

        assertThat(metrics.scrape())
                .contains("ojbk_produce_total{topic=\"orders\",code=\"OK\"} 1")
                .contains("ojbk_produce_total{topic=\"orders\",code=\"AUTH_FAILED\"} 1")
                .contains("ojbk_produce_bytes_total 12")
                .contains("ojbk_produce_latency_seconds_count 2")
                .doesNotContain("token", "payload");
    }
}
