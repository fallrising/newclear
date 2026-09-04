package dev.ojbk.gateway.consume;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

record GatewayConsumeSettings(
        String kafkaBootstrapServers,
        String instanceId,
        int grpcPort,
        int metricsPort,
        Duration configBootstrapTimeout) {

    static GatewayConsumeSettings from(Map<String, String> environment) {
        String instance = optional(environment, "OJBQUAY_INSTANCE_ID");
        if (instance == null) {
            instance = optional(environment, "HOSTNAME");
        }
        if (instance == null) {
            instance = UUID.randomUUID().toString();
        }
        return new GatewayConsumeSettings(
                text(environment, "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
                instance,
                integer(environment, "OJBQUAY_GRPC_PORT", 9_101, 1, 65_535),
                integer(environment, "OJBQUAY_METRICS_PORT", 9_202, 1, 65_535),
                Duration.ofMillis(integer(
                        environment,
                        "OJBQUAY_CONFIG_BOOTSTRAP_TIMEOUT_MS",
                        60_000,
                        1,
                        Integer.MAX_VALUE)));
    }

    GatewayConsumeSettings {
        if (kafkaBootstrapServers == null || kafkaBootstrapServers.isBlank()) {
            throw new IllegalArgumentException("Kafka bootstrap servers must not be blank");
        }
        if (instanceId == null || instanceId.isBlank()) {
            throw new IllegalArgumentException("instance ID must not be blank");
        }
        if (grpcPort < 1 || grpcPort > 65_535) {
            throw new IllegalArgumentException("gRPC port must be 1..65535");
        }
        if (metricsPort < 1 || metricsPort > 65_535) {
            throw new IllegalArgumentException("metrics port must be 1..65535");
        }
        if (configBootstrapTimeout == null
                || configBootstrapTimeout.isZero()
                || configBootstrapTimeout.isNegative()) {
            throw new IllegalArgumentException("config bootstrap timeout must be positive");
        }
    }

    private static String text(
            Map<String, String> environment, String name, String defaultValue) {
        String raw = environment.get(name);
        return raw == null || raw.isBlank() ? defaultValue : raw;
    }

    private static String optional(Map<String, String> environment, String name) {
        String raw = environment.get(name);
        return raw == null || raw.isBlank() ? null : raw;
    }

    private static int integer(
            Map<String, String> environment,
            String name,
            int defaultValue,
            int minimum,
            int maximum) {
        String raw = environment.get(name);
        if (raw == null || raw.isBlank()) {
            return defaultValue;
        }
        try {
            long value = Long.parseLong(raw);
            if (value < minimum || value > maximum) {
                throw new IllegalArgumentException(
                        name + " must be " + minimum + ".." + maximum);
            }
            return (int) value;
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException(name + " must be numeric", invalid);
        }
    }
}
