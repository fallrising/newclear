package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.sdk.OjbkConsumer;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
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
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class PullGrpcE2eTest {
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
    void javaSdkPollsTransformsAndAcknowledgesThroughRealGatewayAndKafka()
            throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String topic = "pull-grpc-" + suffix;
        String group = "pull-grpc-group-" + suffix;
        String token = "abcdef0123456789abcdef0123456789";
        createTopic(topic);

        ConfigStore store = new ConfigStore();
        store.apply(groupEvent(group, token));
        ConfigEvent subscriptionEvent = subscriptionEvent(topic, group);
        store.apply(subscriptionEvent);
        try (PushPipeline pipeline = new PushPipeline();
                PullWorkerRegistry registry = new PullWorkerRegistry(
                        store,
                        subscription -> new PullShareWorker(
                                new KafkaPullBroker(
                                        KAFKA.getBootstrapServers(), subscription),
                                subscription,
                                pipeline,
                                (message, dlqTopic, reason) -> {},
                                Clock.systemUTC()))) {
            registry.onEvent(subscriptionEvent);
            Server server = NettyServerBuilder.forPort(0)
                    .addService(ServerInterceptors.intercept(
                            new ConsumerGrpcService(store, registry),
                            new ConsumerTokenInterceptor()))
                    .build()
                    .start();
            try {
                publish(topic);
                try (OjbkConsumer consumer = OjbkConsumer.forTarget(
                                "127.0.0.1:" + server.getPort(),
                                group,
                                topic,
                                token)
                        .plaintext()
                        .maxBatch(4)
                        .linger(Duration.ofSeconds(1))
                        .build()) {
                    var deliveries = awaitDeliveries(consumer);
                    assertThat(deliveries).hasSize(1);
                    assertThat(deliveries.getFirst().key()).isEqualTo("order-42");
                    assertThat(new String(
                                    deliveries.getFirst().value(),
                                    StandardCharsets.UTF_8))
                            .contains("\"uid\":\"u42\"");
                    assertThat(deliveries.getFirst().tags())
                            .containsExactly("paid");
                    assertThat(deliveries.getFirst().headers())
                            .containsEntry("traceparent", "00-e2e");
                    assertThat(deliveries.getFirst().deliveryCount()).isEqualTo(1);
                    consumer.acknowledge(deliveries, List.of());
                }
            } finally {
                server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
            }
        }

        try (PushPipeline pipeline = new PushPipeline();
                PullWorkerRegistry restarted = new PullWorkerRegistry(
                        store,
                        subscription -> new PullShareWorker(
                                new KafkaPullBroker(
                                        KAFKA.getBootstrapServers(), subscription),
                                subscription,
                                pipeline,
                                (message, dlqTopic, reason) -> {},
                                Clock.systemUTC()))) {
            restarted.onEvent(subscriptionEvent);
            assertThat(restarted.poll(
                                    group, topic, 1, Duration.ofSeconds(2))
                            .deliveries())
                    .isEmpty();
        }
    }

    private static ConfigEvent groupEvent(String group, String token) {
        return new ConfigEvent(
                1,
                ConfigEntityType.GROUP,
                group,
                1,
                Instant.EPOCH,
                "test",
                Map.of(
                        "name", group,
                        "token", token,
                        "owner", "alice",
                        "enabled", true));
    }

    private static ConfigEvent subscriptionEvent(String topic, String group) {
        return new ConfigEvent(
                1,
                ConfigEntityType.SUBSCRIPTION,
                "1",
                1,
                Instant.EPOCH,
                "test",
                Map.of(
                        "id", 1,
                        "group", group,
                        "topic", topic,
                        "owner", "alice",
                        "enabled", true,
                        "spec", Map.ofEntries(
                                Map.entry("mode", "PULL"),
                                Map.entry("concurrency", 4),
                                Map.entry("maxTps", 1_000),
                                Map.entry("ordered", false),
                                Map.entry("tags", List.of("paid")),
                                Map.entry("transit", Map.of("$.uid", "$.user.id")),
                                Map.entry(
                                        "pull",
                                        Map.of(
                                                "maxBatch", 4,
                                                "ackTimeoutMs", 3_000)))));
    }

    private static void createTopic(String topic) throws Exception {
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic(topic, 1, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static void publish(String topic) throws Exception {
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
        RecordHeaders headers = new RecordHeaders();
        headers.add("x-ojbk-tags", "paid".getBytes(StandardCharsets.UTF_8));
        headers.add("traceparent", "00-e2e".getBytes(StandardCharsets.UTF_8));
        try (KafkaProducer<byte[], byte[]> producer =
                new KafkaProducer<>(properties)) {
            producer.send(new ProducerRecord<>(
                            topic,
                            null,
                            null,
                            "order-42".getBytes(StandardCharsets.UTF_8),
                            "{\"id\":42,\"user\":{\"id\":\"u42\"}}"
                                    .getBytes(StandardCharsets.UTF_8),
                            headers))
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static List<dev.ojbk.sdk.OjbkDelivery> awaitDeliveries(
            OjbkConsumer consumer) {
        long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
        while (System.nanoTime() < deadline) {
            var deliveries = consumer.poll();
            if (!deliveries.isEmpty()) {
                return deliveries;
            }
        }
        throw new AssertionError("pull delivery was not observed before timeout");
    }
}
