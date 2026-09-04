package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.SubscriptionConfig;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BooleanSupplier;
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
final class KafkaOrderedPushWorkerTest {
    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0");

    @Test
    void preservesSameKeyOrderWhileAnotherKeyProgresses() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String topic = "ordered-" + suffix;
        String group = "ordered-group-" + suffix;
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(
                            new NewTopic(topic, 1, (short) 1),
                            new NewTopic(topic + "." + group + ".retry", 1, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
        publish(topic, List.of(
                record(topic, "a", "{\"id\":\"a1\"}"),
                record(topic, "a", "{\"id\":\"a2\"}"),
                record(topic, "b", "{\"id\":\"b\"}")));

        List<String> events = Collections.synchronizedList(new ArrayList<>());
        CountDownLatch otherDelivered = new CountDownLatch(1);
        PushHttpClient http = request -> {
            String body = new String(request.body(), StandardCharsets.UTF_8);
            if (body.contains("a1")) {
                events.add("a1-start");
                try {
                    otherDelivered.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    return PushHttpResult.transportFailure(1);
                }
                events.add("a1-end");
            } else if (body.contains("a2")) {
                events.add("a2");
            } else {
                events.add("b");
                otherDelivered.countDown();
            }
            return PushHttpResult.http(204, 1);
        };

        try (PushPipeline pipeline = new PushPipeline();
                KafkaOrderedPushWorker worker = new KafkaOrderedPushWorker(
                        KAFKA.getBootstrapServers(),
                        subscription(topic, group),
                        new OrderedPushRecordHandler(
                                pipeline, http, noRetries(), () -> true))) {
            worker.start();
            await(() -> worker.acceptedCount() == 3, Duration.ofSeconds(15));
            assertThat(events).containsSubsequence("a1-start", "a1-end", "a2");
            assertThat(events.indexOf("b")).isLessThan(events.indexOf("a1-end"));
            assertThat(worker.lastError()).isEmpty();
        }
    }

    private static RetryPublisher noRetries() {
        return new RetryPublisher() {
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
                        Map.entry("concurrency", 2),
                        Map.entry("maxTps", 100),
                        Map.entry("ordered", true),
                        Map.entry("orderKeySource", "KEY"),
                        Map.entry("dlqEnabled", true),
                        Map.entry(
                                "push",
                                Map.of(
                                        "urls", List.of("https://service.example/callback"),
                                        "method", "POST",
                                        "timeoutMs", 5_000,
                                        "retryIntervalsMs", List.of(150)))));
    }

    private static ProducerRecord<byte[], byte[]> record(
            String topic, String key, String value) {
        return new ProducerRecord<>(
                topic,
                key.getBytes(StandardCharsets.UTF_8),
                value.getBytes(StandardCharsets.UTF_8));
    }

    private static void publish(
            String topic, List<ProducerRecord<byte[], byte[]>> records)
            throws Exception {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        try (KafkaProducer<byte[], byte[]> producer = new KafkaProducer<>(properties)) {
            for (ProducerRecord<byte[], byte[]> record : records) {
                producer.send(record).get(10, TimeUnit.SECONDS);
            }
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
}
