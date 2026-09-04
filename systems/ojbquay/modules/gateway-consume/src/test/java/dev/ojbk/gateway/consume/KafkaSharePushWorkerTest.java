package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.SubscriptionConfig;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.config.ConfigResource;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class KafkaSharePushWorkerTest {
    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0")
                    .withEnv("KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR", "1")
                    .withEnv("KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR", "1");

    @Test
    void acceptsSuccessfulRecordAndDoesNotReacquireItForTheGroup() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String topic = "share-orders-" + suffix;
        String group = "settlement-" + suffix;
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(
                            new NewTopic(topic, 1, (short) 1),
                            new NewTopic(topic + "." + group + ".retry", 1, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
        publish(topic, "order-42", "{\"amount\":150}");

        SubscriptionConfig subscription = subscription(topic, group);
        AtomicInteger deliveries = new AtomicInteger();
        try (PushPipeline pipeline = new PushPipeline();
                KafkaSharePushWorker worker = new KafkaSharePushWorker(
                        KAFKA.getBootstrapServers(),
                        subscription,
                        handler(pipeline, deliveries))) {
            assertThat(shareStartOffset(group)).isEqualTo("earliest");
            worker.start();
            await(() -> worker.acceptedCount() == 1, Duration.ofSeconds(15));
            assertThat(deliveries).hasValue(1);
            assertThat(worker.lastError()).isEmpty();
        }

        AtomicInteger reacquired = new AtomicInteger();
        try (PushPipeline pipeline = new PushPipeline();
                KafkaSharePushWorker replacement = new KafkaSharePushWorker(
                        KAFKA.getBootstrapServers(),
                        subscription,
                        handler(pipeline, reacquired))) {
            replacement.start();
            Thread.sleep(1_000);
            assertThat(reacquired).hasValue(0);
            assertThat(replacement.acceptedCount()).isZero();
        }
    }

    private static PushRecordHandler handler(
            PushPipeline pipeline, AtomicInteger deliveries) {
        RetryPublisher unused = new RetryPublisher() {
            @Override
            public void schedule(
                    PushMessage message,
                    String retryTopic,
                    java.time.Instant dueAt,
                    int nextRetryCount) {}

            @Override
            public void publishDlq(
                    PushMessage message, String dlqTopic, String reason) {}
        };
        return new PushRecordHandler(
                pipeline,
                request -> {
                    deliveries.incrementAndGet();
                    return PushHttpResult.http(204, 1);
                },
                unused,
                Clock.systemUTC());
    }

    private static SubscriptionConfig subscription(String topic, String group) {
        return new SubscriptionConfig(
                1,
                group,
                topic,
                "alice",
                true,
                Map.ofEntries(
                        Map.entry("mode", "PUSH"),
                        Map.entry("concurrency", 4),
                        Map.entry("maxTps", 100),
                        Map.entry("ordered", false),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "push",
                                Map.of(
                                        "urls", List.of("https://service.example/callback"),
                                        "method", "POST",
                                        "timeoutMs", 5_000,
                                        "retryIntervalsMs", List.of(150, 300, 600)))));
    }

    private static void publish(String topic, String key, String value) throws Exception {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        try (KafkaProducer<byte[], byte[]> producer = new KafkaProducer<>(properties)) {
            producer.send(new ProducerRecord<>(
                            topic,
                            key.getBytes(StandardCharsets.UTF_8),
                            value.getBytes(StandardCharsets.UTF_8)))
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static void await(BooleanSupplier condition, Duration timeout)
            throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        assertThat(condition.getAsBoolean()).isTrue();
    }

    private static String shareStartOffset(String group) throws Exception {
        ConfigResource resource =
                new ConfigResource(ConfigResource.Type.GROUP, group);
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            return admin.describeConfigs(List.of(resource))
                    .all()
                    .get(10, TimeUnit.SECONDS)
                    .get(resource)
                    .get("share.auto.offset.reset")
                    .value();
        }
    }
}
