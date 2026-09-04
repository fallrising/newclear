package dev.ojbk.gateway.produce;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

record GatewaySettings(
        String kafkaBootstrapServers,
        String instanceId,
        int grpcPort,
        int metricsPort,
        Duration configBootstrapTimeout,
        Duration delayDirectThreshold) {

    static GatewaySettings from(Map<String, String> environment) {
        String instance = environment.get("OJBQUAY_INSTANCE_ID");
        if (instance == null || instance.isBlank()) {
            instance = environment.get("HOSTNAME");
        }
        if (instance == null || instance.isBlank()) {
            instance = UUID.randomUUID().toString();
        }
        return new GatewaySettings(
                text(environment, "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
                instance,
                port(environment, "OJBQUAY_GRPC_PORT", 9_100),
                port(environment, "OJBQUAY_METRICS_PORT", 9_100 + 100),
                Duration.ofMillis(positiveLong(
                        environment, "OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS", 60_000)),
                Duration.ofMillis(nonNegativeLong(
                        environment, "OJBQUAY_DELAY_DIRECT_THRESHOLD_MS", 0)));
    }

    GatewaySettings {
        if (kafkaBootstrapServers == null || kafkaBootstrapServers.isBlank()) {
            throw new IllegalArgumentException("Kafka bootstrap servers must not be blank");
        }
        if (instanceId == null || instanceId.isBlank()) {
            throw new IllegalArgumentException("instance ID must not be blank");
        }
        validatePort(grpcPort, "gRPC");
        validatePort(metricsPort, "metrics");
        if (grpcPort == metricsPort) {
            throw new IllegalArgumentException("gRPC and metrics ports must differ");
        }
        if (configBootstrapTimeout == null
                || configBootstrapTimeout.isZero()
                || configBootstrapTimeout.isNegative()) {
            throw new IllegalArgumentException("config bootstrap timeout must be positive");
        }
        if (delayDirectThreshold == null || delayDirectThreshold.isNegative()) {
            throw new IllegalArgumentException("delay direct threshold must not be negative");
        }
    }

    private static String text(
            Map<String, String> environment, String name, String defaultValue) {
        String value = environment.get(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }

    private static int port(Map<String, String> environment, String name, int defaultValue) {
        long value = positiveLong(environment, name, defaultValue);
        if (value > 65_535) {
            throw new IllegalArgumentException(name + " must be at most 65535");
        }
        return (int) value;
    }

    private static long positiveLong(
            Map<String, String> environment, String name, long defaultValue) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        try {
            long value = Long.parseLong(raw);
            if (value < 1) {
                throw new IllegalArgumentException(name + " must be positive");
            }
            return value;
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException(name + " must be numeric", invalid);
        }
    }

    private static long nonNegativeLong(
            Map<String, String> environment, String name, long defaultValue) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        try {
            long value = Long.parseLong(raw);
            if (value < 0) {
                throw new IllegalArgumentException(name + " must not be negative");
            }
            return value;
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException(name + " must be numeric", invalid);
        }
    }

    private static void validatePort(int port, String name) {
        if (port < 1 || port > 65_535) {
            throw new IllegalArgumentException(name + " port must be 1..65535");
        }
    }
}
