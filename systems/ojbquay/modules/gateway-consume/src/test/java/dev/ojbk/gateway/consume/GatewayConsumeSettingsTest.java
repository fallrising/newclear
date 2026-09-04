package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class GatewayConsumeSettingsTest {
    @Test
    void usesLocalDefaultsAndAcceptsExplicitRuntimeValues() {
        GatewayConsumeSettings defaults = GatewayConsumeSettings.from(Map.of());
        assertThat(defaults.kafkaBootstrapServers()).isEqualTo("localhost:9092");
        assertThat(defaults.grpcPort()).isEqualTo(9_101);
        assertThat(defaults.metricsPort()).isEqualTo(9_202);
        assertThat(defaults.configBootstrapTimeout()).isEqualTo(Duration.ofSeconds(60));

        GatewayConsumeSettings configured = GatewayConsumeSettings.from(Map.of(
                "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "kafka:19092",
                "OJBQUAY_INSTANCE_ID", "consume-1",
                "OJBQUAY_GRPC_PORT", "19101",
                "OJBQUAY_METRICS_PORT", "19202",
                "OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS", "5000"));
        assertThat(configured.instanceId()).isEqualTo("consume-1");
        assertThat(configured.grpcPort()).isEqualTo(19_101);
        assertThat(configured.metricsPort()).isEqualTo(19_202);
        assertThat(configured.configBootstrapTimeout()).isEqualTo(Duration.ofSeconds(5));
    }

    @Test
    void rejectsInvalidPortsAndTimeouts() {
        assertThatThrownBy(() -> GatewayConsumeSettings.from(
                        Map.of("OJBQUAY_METRICS_PORT", "70000")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GatewayConsumeSettings.from(
                        Map.of("OJBQUAY_GRPC_PORT", "0")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GatewayConsumeSettings.from(
                        Map.of("OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS", "0")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
