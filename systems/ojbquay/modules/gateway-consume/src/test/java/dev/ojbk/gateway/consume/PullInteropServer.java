package dev.ojbk.gateway.consume;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.gateway.produce.KafkaBrokerProducer;
import dev.ojbk.gateway.produce.ProducerEngine;
import dev.ojbk.gateway.produce.ProducerGrpcService;
import dev.ojbk.gateway.produce.TokenMetadataInterceptor;
import dev.ojbk.sdk.OjbkConsumer;
import dev.ojbk.sdk.OjbkMessage;
import dev.ojbk.sdk.OjbkProducer;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;

public final class PullInteropServer {
    private PullInteropServer() {}

    public static void main(String[] arguments) throws Exception {
        String bootstrap = environment(
                "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", "localhost:9092");
        String topic = environment(
                "OJBQUAY_INTEROP_TOPIC",
                "pull-interop-" + UUID.randomUUID().toString().substring(0, 8));
        String group = environment("OJBQUAY_INTEROP_GROUP", "pull-interop");
        String topicToken = environment(
                "OJBQUAY_INTEROP_TOPIC_TOKEN",
                "0123456789abcdef0123456789abcdef");
        String groupToken = environment(
                "OJBQUAY_INTEROP_GROUP_TOKEN",
                "abcdef0123456789abcdef0123456789");
        int producerPort = Integer.parseInt(
                environment("OJBQUAY_INTEROP_PRODUCER_PORT", "19100"));
        int consumerPort = Integer.parseInt(
                environment("OJBQUAY_INTEROP_CONSUMER_PORT", "19101"));
        Duration interopTimeout = Duration.ofSeconds(Long.parseLong(
                environment("OJBQUAY_INTEROP_TIMEOUT_SECONDS", "180")));
        createTopic(bootstrap, topic);

        ConfigStore store = config(topic, group, topicToken, groupToken);
        ConfigEvent subscriptionEvent = store.get(
                        ConfigEntityType.SUBSCRIPTION, "1")
                .orElseThrow();
        try (KafkaBrokerProducer broker = new KafkaBrokerProducer(bootstrap);
                PushPipeline pipeline = new PushPipeline();
                PullWorkerRegistry registry = new PullWorkerRegistry(
                        store,
                        subscription -> new PullShareWorker(
                                new KafkaPullBroker(bootstrap, subscription),
                                subscription,
                                pipeline,
                                (message, dlqTopic, reason) -> {},
                                Clock.systemUTC()))) {
            registry.onEvent(subscriptionEvent);
            Server producerServer = NettyServerBuilder.forPort(producerPort)
                    .addService(ServerInterceptors.intercept(
                            new ProducerGrpcService(
                                    new ProducerEngine(store, broker)),
                            new TokenMetadataInterceptor()))
                    .build()
                    .start();
            Server consumerServer = NettyServerBuilder.forPort(consumerPort)
                    .addService(ServerInterceptors.intercept(
                            new ConsumerGrpcService(store, registry),
                            new ConsumerTokenInterceptor()))
                    .build()
                    .start();
            try {
                try (OjbkProducer producer = OjbkProducer.forTarget(
                                "127.0.0.1:" + producerPort, topicToken)
                        .plaintext()
                        .build()) {
                    producer.send(new OjbkMessage(
                            topic,
                            "java-key",
                            "java-to-go".getBytes(StandardCharsets.UTF_8),
                            List.of("interop"),
                            Map.of("traceparent", "00-java"),
                            null));
                }
                System.out.println("READY " + topic);
                System.out.flush();

                awaitAccepted(registry, interopTimeout);
                dev.ojbk.sdk.OjbkDelivery first;
                try (OjbkConsumer consumer = OjbkConsumer.forTarget(
                                "127.0.0.1:" + consumerPort,
                                group,
                                topic,
                                groupToken)
                        .plaintext()
                        .maxBatch(1)
                        .linger(Duration.ofSeconds(1))
                        .build()) {
                    first = awaitDelivery(consumer, interopTimeout).getFirst();
                    assertGoDelivery(first);
                }
                try (OjbkConsumer consumer = OjbkConsumer.forTarget(
                                "127.0.0.1:" + consumerPort,
                                group,
                                topic,
                                groupToken)
                        .plaintext()
                        .maxBatch(1)
                        .linger(Duration.ofSeconds(1))
                        .build()) {
                    var redelivered =
                            awaitDelivery(consumer, interopTimeout).getFirst();
                    assertGoDelivery(redelivered);
                    if (redelivered.deliveryCount() <= first.deliveryCount()
                            || redelivered.ackToken().equals(first.ackToken())) {
                        throw new IllegalStateException(
                                "disconnect did not produce a new delivery attempt");
                    }
                    consumer.acknowledge(List.of(redelivered), List.of());
                }
                System.out.println("INTEROP_OK");
                System.out.flush();
            } finally {
                producerServer.shutdownNow()
                        .awaitTermination(5, TimeUnit.SECONDS);
                consumerServer.shutdownNow()
                        .awaitTermination(5, TimeUnit.SECONDS);
            }
        }
    }

    private static void awaitAccepted(
            PullWorkerRegistry registry, Duration interopTimeout)
            throws InterruptedException {
        long deadline = System.nanoTime() + interopTimeout.toNanos();
        while (registry.acceptedCount() < 1 && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        if (registry.acceptedCount() < 1) {
            throw new IllegalStateException(
                    "Go acknowledgement was not observed before timeout");
        }
    }

    private static List<dev.ojbk.sdk.OjbkDelivery> awaitDelivery(
            OjbkConsumer consumer, Duration interopTimeout) {
        long deadline = System.nanoTime() + interopTimeout.toNanos();
        while (System.nanoTime() < deadline) {
            var deliveries = consumer.poll();
            if (!deliveries.isEmpty()) {
                return deliveries;
            }
        }
        throw new IllegalStateException(
                "Go-produced delivery was not observed before timeout");
    }

    private static ConfigStore config(
            String topic,
            String group,
            String topicToken,
            String groupToken) {
        ConfigStore store = new ConfigStore();
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                topic,
                1,
                Instant.EPOCH,
                "interop",
                Map.ofEntries(
                        Map.entry("name", topic),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 1),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", false),
                        Map.entry("maxMessageBytes", 1_048_576),
                        Map.entry("retentionMs", 86_400_000),
                        Map.entry("produceQuotaTps", 1_000),
                        Map.entry("token", topicToken),
                        Map.entry("owner", "interop"),
                        Map.entry("enabled", true))));
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.GROUP,
                group,
                1,
                Instant.EPOCH,
                "interop",
                Map.of(
                        "name", group,
                        "token", groupToken,
                        "owner", "interop",
                        "enabled", true)));
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.SUBSCRIPTION,
                "1",
                1,
                Instant.EPOCH,
                "interop",
                Map.of(
                        "id", 1,
                        "group", group,
                        "topic", topic,
                        "owner", "interop",
                        "enabled", true,
                        "spec", Map.of(
                                "mode", "PULL",
                                "concurrency", 8,
                                "maxTps", 1_000,
                                "ordered", false,
                                "pull", Map.of(
                                        "maxBatch", 8,
                                        "ackTimeoutMs", 3_000)))));
        return store;
    }

    private static void assertGoDelivery(
            dev.ojbk.sdk.OjbkDelivery delivery) {
        String value = new String(delivery.value(), StandardCharsets.UTF_8);
        if (!"go-to-java".equals(value)
                || !"go-key".equals(delivery.key())
                || !delivery.tags().equals(List.of("interop"))
                || !"00-go".equals(delivery.headers().get("traceparent"))) {
            throw new IllegalStateException(
                    "Java received unexpected Go delivery");
        }
    }

    private static void createTopic(String bootstrap, String topic)
            throws Exception {
        try (Admin admin =
                Admin.create(Map.of("bootstrap.servers", bootstrap))) {
            admin.createTopics(List.of(new NewTopic(topic, 1, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static String environment(String name, String defaultValue) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? defaultValue : value;
    }
}
