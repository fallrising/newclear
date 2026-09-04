package dev.ojbk.console.kafka;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.console.dlq.DlqRecordRef;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
final class DefaultKafkaDlqOperationsTest {
    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0");

    @Test
    void browsesTailAndReplaysExactOffsetWithoutRetryHeaders() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String source = "orders-" + suffix;
        String dlq = source + ".settlement.dlq";
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(
                            new NewTopic(source, 2, (short) 1),
                            new NewTopic(dlq, 2, (short) 1)))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
        long offset = publishDlq(dlq);

        try (DefaultKafkaDlqOperations operations =
                        new DefaultKafkaDlqOperations(KAFKA.getBootstrapServers());
                KafkaConsumer<byte[], byte[]> sourceConsumer = consumer()) {
            var records = operations.readTail(dlq, 10);
            assertThat(records).hasSize(1);
            assertThat(records.getFirst().partition()).isEqualTo(1);
            assertThat(records.getFirst().offset()).isEqualTo(offset);
            assertThat(records.getFirst().key()).isEqualTo("order-42");
            assertThat(records.getFirst().headers())
                    .containsEntry("x-ojbk-retry", "3")
                    .containsEntry("traceparent", "00-test");

            operations.replay(
                    dlq, source, List.of(new DlqRecordRef(1, offset)));

            sourceConsumer.assign(List.of(new org.apache.kafka.common.TopicPartition(source, 1)));
            sourceConsumer.seekToBeginning(sourceConsumer.assignment());
            var replayed = awaitRecord(sourceConsumer);
            assertThat(new String(replayed.key(), StandardCharsets.UTF_8))
                    .isEqualTo("order-42");
            assertThat(new String(replayed.value(), StandardCharsets.UTF_8))
                    .isEqualTo("{\"id\":42}");
            assertThat(replayed.headers().lastHeader("x-ojbk-retry")).isNull();
            assertThat(replayed.headers().lastHeader("x-ojbk-dlq-reason")).isNull();
            assertThat(new String(
                            replayed.headers().lastHeader("traceparent").value(),
                            StandardCharsets.UTF_8))
                    .isEqualTo("00-test");
        }
    }

    private static long publishDlq(String topic) throws Exception {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        RecordHeaders headers = new RecordHeaders();
        headers.add("x-ojbk-retry", "3".getBytes(StandardCharsets.UTF_8));
        headers.add(
                "x-ojbk-dlq-reason",
                "RETRY_EXHAUSTED".getBytes(StandardCharsets.UTF_8));
        headers.add("traceparent", "00-test".getBytes(StandardCharsets.UTF_8));
        try (KafkaProducer<byte[], byte[]> producer = new KafkaProducer<>(properties)) {
            return producer.send(new ProducerRecord<>(
                            topic,
                            1,
                            null,
                            "order-42".getBytes(StandardCharsets.UTF_8),
                            "{\"id\":42}".getBytes(StandardCharsets.UTF_8),
                            headers))
                    .get(10, TimeUnit.SECONDS)
                    .offset();
        }
    }

    private static KafkaConsumer<byte[], byte[]> consumer() {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return new KafkaConsumer<>(properties);
    }

    private static org.apache.kafka.clients.consumer.ConsumerRecord<byte[], byte[]> awaitRecord(
            KafkaConsumer<byte[], byte[]> consumer) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            var records = consumer.poll(Duration.ofMillis(100));
            if (!records.isEmpty()) {
                return records.iterator().next();
            }
        }
        throw new AssertionError("replayed record was not observed before timeout");
    }
}
