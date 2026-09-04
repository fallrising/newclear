package dev.ojbk.scheduler;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;

record SchedulerSettings(
        String kafkaBootstrapServers,
        String databaseUrl,
        String databaseUser,
        String databasePassword,
        String instanceId,
        int metricsPort,
        int dispatcherWorkers,
        Duration pollTimeout,
        Duration dispatchTick,
        Duration terminalRetention) {

    static SchedulerSettings from(Map<String, String> environment) {
        String instance = optionalText(environment, "OJBQUAY_INSTANCE_ID");
        if (instance == null) {
            instance = optionalText(environment, "HOSTNAME");
        }
        if (instance == null) {
            instance = UUID.randomUUID().toString();
        }
        int workers = integer(environment, "OJBQUAY_SCHEDULER_WORKERS", 2);
        if (workers > 64) {
            throw new IllegalArgumentException(
                    "OJBQUAY_SCHEDULER_WORKERS must be at most 64");
        }
        return new SchedulerSettings(
                text(environment, "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092"),
                text(
                        environment,
                        "OJBQUAY_DATABASE_URL",
                        "jdbc:postgresql://localhost:5432/ojbquay"),
                text(environment, "OJBQUAY_DATABASE_USER", "ojbquay"),
                text(
                        environment,
                        "OJBQUAY_DATABASE_PASSWORD",
                        "local-development-only"),
                instance,
                port(environment, "OJBQUAY_METRICS_PORT", 9_201),
                workers,
                Duration.ofMillis(integer(
                        environment, "OJBQUAY_SCHEDULER_POLL_MS", 250)),
                Duration.ofMillis(integer(
                        environment, "OJBQUAY_SCHEDULER_TICK_MS", 100)),
                Duration.ofMillis(longValue(
                        environment,
                        "OJBQUAY_SCHEDULER_TERMINAL_RETENTION_MS",
                        Duration.ofHours(24).toMillis())));
    }

    SchedulerSettings {
        requireText(kafkaBootstrapServers, "Kafka bootstrap servers");
        requireText(databaseUrl, "database URL");
        requireText(databaseUser, "database user");
        requireText(databasePassword, "database password");
        requireText(instanceId, "instance ID");
        if (metricsPort < 1 || metricsPort > 65_535) {
            throw new IllegalArgumentException("metrics port must be 1..65535");
        }
        if (dispatcherWorkers < 1 || dispatcherWorkers > 64) {
            throw new IllegalArgumentException("dispatcher workers must be 1..64");
        }
        requirePositive(pollTimeout, "poll timeout");
        requirePositive(dispatchTick, "dispatch tick");
        requirePositive(terminalRetention, "terminal retention");
    }

    private static String text(
            Map<String, String> environment, String name, String defaultValue) {
        if (!environment.containsKey(name)) {
            return defaultValue;
        }
        String value = environment.get(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    private static String optionalText(Map<String, String> environment, String name) {
        String value = environment.get(name);
        return value == null || value.isBlank() ? null : value;
    }

    private static int integer(
            Map<String, String> environment, String name, int defaultValue) {
        long value = longValue(environment, name, defaultValue);
        if (value > Integer.MAX_VALUE) {
            throw new IllegalArgumentException(name + " is too large");
        }
        return (int) value;
    }

    private static int port(
            Map<String, String> environment, String name, int defaultValue) {
        int value = integer(environment, name, defaultValue);
        if (value > 65_535) {
            throw new IllegalArgumentException(name + " must be at most 65535");
        }
        return value;
    }

    private static long longValue(
            Map<String, String> environment, String name, long defaultValue) {
        String raw = environment.get(name);
        if (raw == null) {
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

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }

    private static void requirePositive(Duration value, String name) {
        if (value == null || value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
