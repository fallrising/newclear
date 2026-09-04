package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class SchedulerSettingsTest {
    @Test
    void usesBoundedOperationalDefaults() {
        SchedulerSettings settings =
                SchedulerSettings.from(Map.of("HOSTNAME", "scheduler-1"));

        assertThat(settings.kafkaBootstrapServers()).isEqualTo("localhost:9092");
        assertThat(settings.databaseUrl())
                .isEqualTo("jdbc:postgresql://localhost:5432/ojbquay");
        assertThat(settings.instanceId()).isEqualTo("scheduler-1");
        assertThat(settings.metricsPort()).isEqualTo(9_201);
        assertThat(settings.dispatcherWorkers()).isEqualTo(2);
        assertThat(settings.pollTimeout()).isEqualTo(Duration.ofMillis(250));
        assertThat(settings.dispatchTick()).isEqualTo(Duration.ofMillis(100));
        assertThat(settings.terminalRetention()).isEqualTo(Duration.ofHours(24));
    }

    @Test
    void rejectsUnboundedOrInvalidRuntimeValues() {
        assertThatThrownBy(() -> SchedulerSettings.from(
                        Map.of("OJBQUAY_SCHEDULER_WORKERS", "65")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SchedulerSettings.from(
                        Map.of("OJBQUAY_SCHEDULER_TICK_MS", "0")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> SchedulerSettings.from(
                        Map.of("OJBQUAY_DATABASE_PASSWORD", "")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
