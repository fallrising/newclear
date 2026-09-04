package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class GatewaySettingsTest {

    @Test
    void readsBoundedRuntimeConfigurationFromEnvironment() {
        GatewaySettings settings = GatewaySettings.from(Map.of(
                "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "kafka:9092",
                "OJBQUAY_INSTANCE_ID", "produce-1",
                "OJBQUAY_GRPC_PORT", "19100",
                "OJBQUAY_METRICS_PORT", "19200",
                "OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS", "5000",
                "OJBQUAY_DELAY_DIRECT_THRESHOLD_MS", "250"));

        assertThat(settings.kafkaBootstrapServers()).isEqualTo("kafka:9092");
        assertThat(settings.instanceId()).isEqualTo("produce-1");
        assertThat(settings.grpcPort()).isEqualTo(19_100);
        assertThat(settings.metricsPort()).isEqualTo(19_200);
        assertThat(settings.configBootstrapTimeout()).isEqualTo(Duration.ofSeconds(5));
        assertThat(settings.delayDirectThreshold()).isEqualTo(Duration.ofMillis(250));
    }

    @Test
    void rejectsInvalidOrCollidingPorts() {
        assertThatThrownBy(() -> GatewaySettings.from(Map.of(
                        "OJBQUAY_GRPC_PORT", "9100", "OJBQUAY_METRICS_PORT", "9100")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> GatewaySettings.from(Map.of("OJBQUAY_GRPC_PORT", "70000")))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
