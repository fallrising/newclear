package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.delay.DelayCommand;
import dev.ojbk.delay.DelayCommandCodec;
import dev.ojbk.messaging.MessageLimits;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class KafkaRetryPublisherTest {
    private static final String RETRY = "orders.settlement.retry";
    private static final String DLQ = "orders.settlement.dlq";

    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0");

    @Test
    void writesVersionedDelayCommandAndDlqRecordWithOriginalIdentity()
            throws Exception {
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(
                            topic(DelayCommand.INBOX_TOPIC, MessageLimits.MAX_DELAY_COMMAND_BYTES),
                            topic(RETRY, MessageLimits.MAX_KAFKA_REQUEST_BYTES),
                            topic(DLQ, MessageLimits.MAX_KAFKA_REQUEST_BYTES)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }

        PushMessage message = new PushMessage(
                "orders",
                1,
                42,
                Instant.parse("2026-07-29T12:00:00Z"),
                "order-42",
                "value".getBytes(StandardCharsets.UTF_8),
                List.of("paid"),
                Map.of("traceparent", "00-test"),
                1);
        Instant due = Instant.parse("2026-07-29T12:00:00.150Z");
        try (KafkaRetryPublisher publisher =
                        new KafkaRetryPublisher(KAFKA.getBootstrapServers());
                KafkaConsumer<String, byte[]> inbox = consumer();
                KafkaConsumer<String, byte[]> dlq = consumer()) {
            inbox.subscribe(List.of(DelayCommand.INBOX_TOPIC));
            dlq.subscribe(List.of(DLQ));

            publisher.schedule(message, RETRY, due, 1);
            publisher.publishDlq(message, DLQ, "RETRY_EXHAUSTED");

            var commandRecord = awaitRecord(inbox);
            DelayCommand command = new DelayCommandCodec().decode(commandRecord.value());
            assertThat(command.targetTopic()).isEqualTo(RETRY);
            assertThat(command.dueAtMs()).isEqualTo(due.toEpochMilli());
            assertThat(command.partition()).isEqualTo(1);
            assertThat(command.headers())
                    .containsEntry("x-ojbk-origin-topic", "orders")
                    .containsEntry("x-ojbk-origin-offset", "42")
                    .containsEntry("x-ojbk-retry", "1")
                    .containsEntry("traceparent", "00-test");

            var dlqRecord = awaitRecord(dlq);
            assertThat(dlqRecord.key()).isEqualTo("order-42");
            assertThat(new String(dlqRecord.value(), StandardCharsets.UTF_8))
                    .isEqualTo("value");
            assertThat(header(dlqRecord, "x-ojbk-dlq-reason"))
                    .isEqualTo("RETRY_EXHAUSTED");
            assertThat(header(dlqRecord, "x-ojbk-origin-topic")).isEqualTo("orders");
        }
    }

    private static NewTopic topic(String name, int maxBytes) {
        return new NewTopic(name, 3, (short) 1)
                .configs(Map.of("max.message.bytes", Integer.toString(maxBytes)));
    }

    private KafkaConsumer<String, byte[]> consumer() {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, "retry-test-" + UUID.randomUUID());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return new KafkaConsumer<>(properties);
    }

    private static org.apache.kafka.clients.consumer.ConsumerRecord<String, byte[]> awaitRecord(
            KafkaConsumer<String, byte[]> consumer) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            var records = consumer.poll(Duration.ofMillis(100));
            if (!records.isEmpty()) {
                return records.iterator().next();
            }
        }
        throw new AssertionError("Kafka record was not observed before timeout");
    }

    private static String header(
            org.apache.kafka.clients.consumer.ConsumerRecord<String, byte[]> record,
            String name) {
        return new String(record.headers().lastHeader(name).value(), StandardCharsets.UTF_8);
    }
}
