package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class KafkaConfigBusIntegrationTest {
    @Container
    private static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:4.2.0");

    @Test
    void bootstrapsExistingEventsAndPublishesSubsequentChanges() throws Exception {
        try (Admin admin = Admin.create(
                        Map.of("bootstrap.servers", KAFKA.getBootstrapServers()));
                KafkaConfigPublisher publisher =
                        new KafkaConfigPublisher(KAFKA.getBootstrapServers())) {
            admin.createTopics(List.of(new NewTopic(
                            KafkaConfigPublisher.CONFIG_TOPIC, 1, (short) 1)
                    .configs(Map.of("cleanup.policy", "compact"))))
                    .all()
                    .get(10, TimeUnit.SECONDS);
            publisher.publish(event(1, true));

            ConfigStore store = new ConfigStore();
            List<Long> observedVersions = new CopyOnWriteArrayList<>();
            List<String> observedDeletions = new CopyOnWriteArrayList<>();
            try (KafkaConfigBusClient client = new KafkaConfigBusClient(
                    KAFKA.getBootstrapServers(), "common-test", "instance-1", store)) {
                client.addListener(event -> observedVersions.add(event.version()));
                client.addDeletionListener(
                        (type, id) -> observedDeletions.add(type + ":" + id));
                client.start();

                await(Duration.ofSeconds(10), client::ready);
                assertThat(store.get(ConfigEntityType.TOPIC, "orders"))
                        .get()
                        .extracting(ConfigEvent::version)
                        .isEqualTo(1L);

                publisher.publish(event(2, false));
                await(
                        Duration.ofSeconds(10),
                        () -> store.get(ConfigEntityType.TOPIC, "orders")
                                        .map(ConfigEvent::version)
                                        .orElse(0L)
                                == 2);

                assertThat(observedVersions).containsExactly(1L, 2L);

                publisher.delete(ConfigEntityType.TOPIC, "orders");
                await(
                        Duration.ofSeconds(10),
                        () -> store.topic("orders").isEmpty());
                assertThat(observedDeletions).containsExactly("TOPIC:orders");
                assertThat(client.lastError()).isEmpty();
            }
        }
    }

    private static ConfigEvent event(long version, boolean enabled) {
        return new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                version,
                Instant.now(),
                "test",
                Map.ofEntries(
                        Map.entry("name", "orders"),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", false),
                        Map.entry("maxMessageBytes", 1_048_576),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 1_000),
                        Map.entry("token", "0123456789abcdef0123456789abcdef"),
                        Map.entry("owner", "alice"),
                        Map.entry("enabled", enabled)));
    }

    private static void await(Duration timeout, Condition condition) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.evaluate() && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        assertThat(condition.evaluate()).isTrue();
    }

    @FunctionalInterface
    private interface Condition {
        boolean evaluate();
    }
}
