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
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class KafkaPullBrokerTest {
    private static final Duration DELIVERY_WAIT = Duration.ofSeconds(30);

    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0")
                    .withEnv(
                            "KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR",
                            "1")
                    .withEnv(
                            "KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR",
                            "1")
                    .withEnv(
                            "KAFKA_GROUP_SHARE_MIN_RECORD_LOCK_DURATION_MS",
                            "1000")
                    .withEnv(
                            "KAFKA_GROUP_SHARE_MAX_RECORD_LOCK_DURATION_MS",
                            "300000");

    @Test
    void releasesWithIncrementedDeliveryCountAndAcceptSurvivesRestart()
            throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String topic = "pull-" + suffix;
        String group = "pull-group-" + suffix;
        createTopic(topic);
        publish(topic, "payload");
        SubscriptionConfig subscription = subscription(topic, group, 3_000);

        PullDelivery redelivered;
        try (PushPipeline pipeline = new PushPipeline();
                PullShareWorker worker = worker(subscription, pipeline)) {
            worker.start();
            PullDelivery first =
                    worker.pollBatch(1, DELIVERY_WAIT).getFirst();
            assertThat(first.deliveryCount()).isEqualTo(1);
            PullAckResult released = worker.acknowledge(
                    List.of(),
                    List.of(first.ackToken()),
                    Duration.ofSeconds(5));
            assertThat(released.code())
                    .as(worker.lastError().orElse("worker has no error"))
                    .isEqualTo(ojbk.v1.Code.OK);

            redelivered =
                    worker.pollBatch(1, DELIVERY_WAIT).getFirst();
            assertThat(redelivered.deliveryCount()).isEqualTo(2);
            assertThat(redelivered.ackToken()).isNotEqualTo(first.ackToken());
            assertThat(worker.acknowledge(
                                    List.of(redelivered.ackToken()),
                                    List.of(),
                                    Duration.ofSeconds(5))
                            .code())
                    .isEqualTo(ojbk.v1.Code.OK);
        }

        try (PushPipeline pipeline = new PushPipeline();
                PullShareWorker restarted = worker(subscription, pipeline)) {
            restarted.start();
            assertThat(restarted.pollBatch(1, Duration.ofSeconds(2))).isEmpty();
        }
    }

    @Test
    void releasesAnUnacknowledgedDeliveryAfterItsLease() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String topic = "pull-expire-" + suffix;
        String group = "pull-expire-group-" + suffix;
        createTopic(topic);
        publish(topic, "expires");
        SubscriptionConfig subscription = subscription(topic, group, 1_000);

        try (PushPipeline pipeline = new PushPipeline();
                PullShareWorker worker = worker(subscription, pipeline)) {
            worker.start();
            PullDelivery first =
                    worker.pollBatch(1, DELIVERY_WAIT).getFirst();
            PullDelivery redelivered =
                    worker.pollBatch(1, DELIVERY_WAIT).getFirst();

            assertThat(redelivered.offset()).isEqualTo(first.offset());
            assertThat(redelivered.deliveryCount()).isGreaterThan(1);
            assertThat(redelivered.ackToken()).isNotEqualTo(first.ackToken());
        }
    }

    private static PullShareWorker worker(
            SubscriptionConfig subscription, PushPipeline pipeline) {
        return new PullShareWorker(
                new KafkaPullBroker(KAFKA.getBootstrapServers(), subscription),
                subscription,
                pipeline,
                (message, topic, reason) -> {},
                Clock.systemUTC());
    }

    private static SubscriptionConfig subscription(
            String topic, String group, int ackTimeoutMs) {
        return new SubscriptionConfig(
                1,
                group,
                topic,
                "alice",
                true,
                Map.ofEntries(
                        Map.entry("mode", "PULL"),
                        Map.entry("concurrency", 4),
                        Map.entry("maxTps", 1_000),
                        Map.entry("ordered", false),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "pull",
                                Map.of(
                                        "maxBatch", 4,
                                        "ackTimeoutMs", ackTimeoutMs,
                                        "maxRetry", 3))));
    }

    private static void createTopic(String topic) throws Exception {
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic(topic, 1, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static void publish(String topic, String value) throws Exception {
        Properties properties = new Properties();
        properties.put(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG,
                KAFKA.getBootstrapServers());
        properties.put(
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
                ByteArraySerializer.class);
        properties.put(
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
                ByteArraySerializer.class);
        try (KafkaProducer<byte[], byte[]> producer =
                new KafkaProducer<>(properties)) {
            producer.send(new ProducerRecord<>(
                            topic,
                            "key".getBytes(StandardCharsets.UTF_8),
                            value.getBytes(StandardCharsets.UTF_8)))
                    .get(10, TimeUnit.SECONDS);
        }
    }
}
