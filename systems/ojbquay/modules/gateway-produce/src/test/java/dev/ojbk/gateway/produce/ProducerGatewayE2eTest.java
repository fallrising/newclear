package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.KafkaConfigBusClient;
import dev.ojbk.config.KafkaConfigPublisher;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.sdk.OjbkMessage;
import dev.ojbk.sdk.OjbkProducer;
import dev.ojbk.sdk.ProduceAcknowledgement;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class ProducerGatewayE2eTest {
    @Container
    private static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:4.2.0");

    @Test
    void javaSdkSendsThroughGrpcAndReturnsTheStoredKafkaPosition() throws Exception {
        String bootstrap = KAFKA.getBootstrapServers();
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", bootstrap))) {
            admin.createTopics(List.of(
                            new NewTopic(KafkaConfigPublisher.CONFIG_TOPIC, 1, (short) 1)
                                    .configs(Map.of("cleanup.policy", "compact")),
                            new NewTopic("orders", 3, (short) 1)
                                    .configs(Map.of(
                                            "max.message.bytes",
                                            Integer.toString(
                                                    MessageLimits.kafkaRecordLimit(
                                                            MessageLimits.MAX_VALUE_BYTES))))))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }

        try (KafkaConfigPublisher configPublisher = new KafkaConfigPublisher(bootstrap)) {
            configPublisher.publish(topicEvent());
        }

        ConfigStore store = new ConfigStore();
        ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
        try (KafkaConfigBusClient configBus =
                        new KafkaConfigBusClient(bootstrap, "gateway-e2e", "instance-1", store);
                KafkaBrokerProducer broker = new KafkaBrokerProducer(bootstrap)) {
            configBus.start();
            await(Duration.ofSeconds(10), configBus::ready);

            Server server = NettyServerBuilder.forPort(0)
                    .maxInboundMessageSize(MessageLimits.MAX_KAFKA_REQUEST_BYTES)
                    .executor(executor)
                    .addService(ServerInterceptors.intercept(
                            new ProducerGrpcService(new ProducerEngine(store, broker)),
                            new TokenMetadataInterceptor()))
                    .build()
                    .start();
            try (OjbkProducer producer = OjbkProducer.forTarget(
                            "localhost:" + server.getPort(), token())
                    .plaintext()
                    .deadline(Duration.ofSeconds(5))
                    .build();
                    KafkaConsumer<byte[], byte[]> consumer = consumer(bootstrap)) {
                consumer.subscribe(List.of("orders"));
                OjbkMessage message = new OjbkMessage(
                        "orders",
                        "order-42",
                        "stored-value".getBytes(StandardCharsets.UTF_8),
                        List.of("paid", "priority"),
                        Map.of("traceparent", "00-e2e-trace"),
                        1);

                ProduceAcknowledgement acknowledgement = producer.send(message);
                var record = awaitRecord(consumer, Duration.ofSeconds(10));

                assertThat(acknowledgement)
                        .isEqualTo(new ProduceAcknowledgement(
                                record.topic(), record.partition(), record.offset()));
                assertThat(new String(record.key(), StandardCharsets.UTF_8))
                        .isEqualTo("order-42");
                assertThat(new String(record.value(), StandardCharsets.UTF_8))
                        .isEqualTo("stored-value");
                assertThat(header(record, "x-ojbk-tags")).isEqualTo("paid,priority");
                assertThat(header(record, "traceparent")).isEqualTo("00-e2e-trace");

                byte[] maximumValue = new byte[MessageLimits.MAX_VALUE_BYTES];
                maximumValue[maximumValue.length - 1] = 42;
                ProduceAcknowledgement maximumAcknowledgement = producer.send(
                        new OjbkMessage(
                                "orders",
                                "maximum-value",
                                maximumValue,
                                List.of(),
                                Map.of(),
                                2));
                var maximumRecord = awaitRecord(consumer, Duration.ofSeconds(10));
                assertThat(maximumAcknowledgement.offset())
                        .isEqualTo(maximumRecord.offset());
                assertThat(maximumRecord.value())
                        .hasSize(MessageLimits.MAX_VALUE_BYTES)
                        .endsWith(42);
            } finally {
                server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
            }
        } finally {
            executor.close();
        }
    }

    private static KafkaConsumer<byte[], byte[]> consumer(String bootstrap) {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrap);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, "gateway-e2e-" + UUID.randomUUID());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return new KafkaConsumer<>(properties);
    }

    private static org.apache.kafka.clients.consumer.ConsumerRecord<byte[], byte[]> awaitRecord(
            KafkaConsumer<byte[], byte[]> consumer, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            var records = consumer.poll(Duration.ofMillis(100));
            if (!records.isEmpty()) {
                return records.iterator().next();
            }
        }
        throw new AssertionError("Kafka record was not observed before timeout");
    }

    private static void await(Duration timeout, Condition condition) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.evaluate() && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        assertThat(condition.evaluate()).isTrue();
    }

    private static String header(
            org.apache.kafka.clients.consumer.ConsumerRecord<byte[], byte[]> record,
            String name) {
        return new String(record.headers().lastHeader(name).value(), StandardCharsets.UTF_8);
    }

    private static ConfigEvent topicEvent() {
        return new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                1,
                Instant.parse("2026-07-29T12:00:00Z"),
                "e2e",
                Map.ofEntries(
                        Map.entry("name", "orders"),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", false),
                        Map.entry("maxMessageBytes", MessageLimits.MAX_VALUE_BYTES),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 1_000),
                        Map.entry("token", token()),
                        Map.entry("owner", "alice"),
                        Map.entry("enabled", true)));
    }

    private static String token() {
        return "0123456789abcdef0123456789abcdef";
    }

    @FunctionalInterface
    private interface Condition {
        boolean evaluate();
    }
}
