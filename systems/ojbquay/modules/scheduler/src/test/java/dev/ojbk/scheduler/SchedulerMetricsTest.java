package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

final class SchedulerMetricsTest {
    @Test
    void exposesBoundedDelayCountersGaugeAndLagHistogram() {
        SchedulerMetrics metrics = new SchedulerMetrics();

        metrics.recordIngested(2);
        metrics.recordFired(Duration.ofMillis(250));
        metrics.recordFireFailure();
        metrics.setPending(7);

        assertThat(metrics.scrape())
                .contains("ojbk_delay_pending 7")
                .contains("ojbk_delay_fired_total{result=\"success\"} 1")
                .contains("ojbk_delay_fired_total{result=\"failure\"} 1")
                .contains("ojbk_delay_fire_lag_seconds_count 1")
                .contains("ojbk_delay_fire_lag_seconds_sum 0.250000000")
                .contains("ojbk_delay_ingested_total 2");
    }
}
