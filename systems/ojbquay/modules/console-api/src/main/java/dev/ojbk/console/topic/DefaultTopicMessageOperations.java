package dev.ojbk.console.topic;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.pipeline.CelFilter;
import dev.ojbk.pipeline.MessageVariables;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.PriorityQueue;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;

public final class DefaultTopicMessageOperations implements TopicMessageOperations {
    private static final int MAX_SAMPLE_FETCH_BYTES = 16 * 1_024 * 1_024;
    private static final Duration SAMPLE_TIMEOUT = Duration.ofSeconds(3);

    private final String bootstrapServers;
    private final KafkaProducer<byte[], byte[]> producer;
    private final CelFilter cel = new CelFilter();
    private final ObjectMapper objectMapper = new ObjectMapper();

    public DefaultTopicMessageOperations(String bootstrapServers) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException(
                    "bootstrapServers must not be blank");
        }
        this.bootstrapServers = bootstrapServers;
        producer = new KafkaProducer<>(producerProperties(bootstrapServers));
    }

    @Override
    public List<TopicSample> sample(
            String topic,
            int partitions,
            int maximum,
            boolean redact,
            String expression) {
        cel.validate(expression);
        List<TopicPartition> assigned = java.util.stream.IntStream.range(
                        0, partitions)
                .mapToObj(partition -> new TopicPartition(topic, partition))
                .toList();
        PriorityQueue<TopicSample> newest = new PriorityQueue<>(
                maximum, Comparator.comparing(TopicSample::timestamp)
                        .thenComparingInt(TopicSample::partition)
                        .thenComparingLong(TopicSample::offset));
        try (KafkaConsumer<byte[], byte[]> consumer =
                new KafkaConsumer<>(consumerProperties())) {
            consumer.assign(assigned);
            Map<TopicPartition, Long> ends = consumer.endOffsets(assigned);
            assigned.forEach(partition -> consumer.seek(
                    partition,
                    Math.max(0, ends.get(partition) - maximum)));
            long deadline = System.nanoTime() + SAMPLE_TIMEOUT.toNanos();
            while (!finished(consumer, ends)
                    && System.nanoTime() < deadline) {
                consumer.poll(Duration.ofMillis(100)).forEach(record -> {
                    TopicSample sample = sample(record, redact, expression);
                    newest.offer(sample);
                    if (newest.size() > maximum) {
                        newest.poll();
                    }
                });
            }
        }
        return newest.stream()
                .sorted(Comparator.comparing(TopicSample::timestamp)
                        .thenComparingInt(TopicSample::partition)
                        .thenComparingLong(TopicSample::offset)
                        .reversed())
                .toList();
    }

    @Override
    public TestMessageResult publish(
            String topic, PreparedTestMessage message) {
        List<org.apache.kafka.common.header.Header> headers =
                new ArrayList<>(message.headers().size() + 1);
        message.headers().forEach((key, value) -> headers.add(new RecordHeader(
                key, value.getBytes(StandardCharsets.UTF_8))));
        if (!message.tags().isEmpty()) {
            headers.add(new RecordHeader(
                    "x-ojbk-tags",
                    String.join(",", message.tags())
                            .getBytes(StandardCharsets.UTF_8)));
        }
        try {
            var metadata = producer.send(new ProducerRecord<>(
                            topic,
                            message.partition(),
                            null,
                            message.key() == null
                                    ? null
                                    : message.key()
                                            .getBytes(StandardCharsets.UTF_8),
                            message.value(),
                            headers))
                    .get();
            return new TestMessageResult(
                    metadata.topic(),
                    metadata.partition(),
                    metadata.offset());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "test message publication was interrupted", interrupted);
        } catch (ExecutionException failure) {
            throw new IllegalStateException(
                    "test message publication failed", failure.getCause());
        }
    }

    private TopicSample sample(
            org.apache.kafka.clients.consumer.ConsumerRecord<byte[], byte[]> record,
            boolean redact,
            String expression) {
        Map<String, String> headers = new LinkedHashMap<>();
        record.headers().forEach(header -> headers.put(
                header.key(),
                header.value() == null
                        ? ""
                        : new String(header.value(), StandardCharsets.UTF_8)));
        String rawTags = headers.get("x-ojbk-tags");
        List<String> tags = rawTags == null || rawTags.isBlank()
                ? List.of()
                : java.util.Arrays.stream(rawTags.split(","))
                        .filter(tag -> !tag.isBlank())
                        .toList();
        byte[] value = record.value() == null ? new byte[0] : record.value();
        String key = record.key() == null
                ? null
                : new String(record.key(), StandardCharsets.UTF_8);
        boolean matched = cel.matches(
                expression,
                new MessageVariables(
                        key,
                        tags,
                        headers,
                        parse(value),
                        value));
        return new TopicSample(
                record.partition(),
                record.offset(),
                Instant.ofEpochMilli(Math.max(0, record.timestamp())),
                key,
                redact ? "" : Base64.getEncoder().encodeToString(value),
                tags,
                headers,
                redact,
                matched);
    }

    private Object parse(byte[] value) {
        try {
            return objectMapper.readValue(value, Object.class);
        } catch (java.io.IOException invalidJson) {
            return null;
        }
    }

    private static boolean finished(
            KafkaConsumer<byte[], byte[]> consumer,
            Map<TopicPartition, Long> ends) {
        return ends.entrySet().stream().allMatch(entry ->
                consumer.position(entry.getKey()) >= entry.getValue());
    }

    private Properties consumerProperties() {
        Properties properties = new Properties();
        properties.put(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(
                ConsumerConfig.GROUP_ID_CONFIG,
                "ojbquay-sample-" + UUID.randomUUID());
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
                ByteArrayDeserializer.class);
        properties.put(
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
                ByteArrayDeserializer.class);
        properties.put(
                ConsumerConfig.MAX_PARTITION_FETCH_BYTES_CONFIG,
                MessageLimits.MAX_KAFKA_REQUEST_BYTES);
        properties.put(
                ConsumerConfig.FETCH_MAX_BYTES_CONFIG,
                MAX_SAMPLE_FETCH_BYTES);
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 1_000);
        return properties;
    }

    private static Properties producerProperties(String bootstrapServers) {
        Properties properties = new Properties();
        properties.put(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
                ByteArraySerializer.class);
        properties.put(
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
                ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_KAFKA_REQUEST_BYTES);
        properties.put(
                ProducerConfig.CLIENT_ID_CONFIG,
                "ojbquay-console-test-message");
        return properties;
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(10));
        cel.close();
    }
}
