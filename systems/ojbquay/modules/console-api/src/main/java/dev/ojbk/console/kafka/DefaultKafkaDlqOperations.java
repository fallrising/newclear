package dev.ojbk.console.kafka;

import dev.ojbk.console.dlq.DlqRecordRef;
import dev.ojbk.console.dlq.DlqRecordView;
import dev.ojbk.messaging.MessageLimits;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;

public final class DefaultKafkaDlqOperations implements KafkaDlqOperations {
    private static final Duration IO_TIMEOUT = Duration.ofSeconds(5);
    private static final Set<String> REPLAY_REMOVED_HEADERS = Set.of(
            "x-ojbk-retry", "x-ojbk-dlq-reason", "x-ojbk-delay-id");

    private final String bootstrapServers;
    private final KafkaProducer<byte[], byte[]> producer;

    public DefaultKafkaDlqOperations(String bootstrapServers) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        this.bootstrapServers = bootstrapServers;
        producer = new KafkaProducer<>(producerProperties(bootstrapServers));
    }

    @Override
    public List<DlqRecordView> readTail(String dlqTopic, int limit) {
        requireTopic(dlqTopic);
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException("DLQ read limit must be 1..500");
        }
        try (KafkaConsumer<byte[], byte[]> consumer = consumer()) {
            List<TopicPartition> partitions = partitions(consumer, dlqTopic);
            consumer.assign(partitions);
            Map<TopicPartition, Long> beginnings = consumer.beginningOffsets(partitions);
            Map<TopicPartition, Long> ends = consumer.endOffsets(partitions);
            partitions.forEach(partition -> consumer.seek(
                    partition,
                    Math.max(beginnings.get(partition), ends.get(partition) - limit)));

            List<ConsumerRecord<byte[], byte[]>> fetched =
                    pollUntilPositions(consumer, ends, limit * partitions.size());
            return fetched.stream()
                    .sorted(Comparator.comparingLong(
                                    (ConsumerRecord<byte[], byte[]> record) ->
                                            record.timestamp())
                            .thenComparingInt(ConsumerRecord::partition)
                            .thenComparingLong(ConsumerRecord::offset)
                            .reversed())
                    .limit(limit)
                    .map(DefaultKafkaDlqOperations::view)
                    .toList();
        }
    }

    @Override
    public void replay(
            String dlqTopic, String sourceTopic, List<DlqRecordRef> records) {
        requireTopic(dlqTopic);
        requireTopic(sourceTopic);
        List<DlqRecordRef> requested = List.copyOf(records);
        if (requested.isEmpty() || requested.size() > 500) {
            throw new IllegalArgumentException("DLQ replay must contain 1..500 records");
        }
        if (Set.copyOf(requested).size() != requested.size()) {
            throw new IllegalArgumentException("DLQ replay contains duplicate offsets");
        }

        Map<DlqRecordRef, ConsumerRecord<byte[], byte[]>> found =
                readExact(dlqTopic, requested);
        List<org.apache.kafka.clients.producer.RecordMetadata> acknowledgements =
                new ArrayList<>(requested.size());
        for (DlqRecordRef reference : requested) {
            ConsumerRecord<byte[], byte[]> record = found.get(reference);
            try {
                acknowledgements.add(producer.send(new ProducerRecord<>(
                                sourceTopic,
                                reference.partition(),
                                null,
                                record.key(),
                                record.value(),
                                replayHeaders(record)))
                        .get());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("DLQ replay was interrupted", interrupted);
            } catch (ExecutionException failure) {
                throw new IllegalStateException(
                        "DLQ replay publication failed", failure.getCause());
            }
        }
        if (acknowledgements.size() != requested.size()) {
            throw new IllegalStateException("DLQ replay was incomplete");
        }
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(5));
    }

    private Map<DlqRecordRef, ConsumerRecord<byte[], byte[]>> readExact(
            String topic, List<DlqRecordRef> requested) {
        try (KafkaConsumer<byte[], byte[]> consumer = consumer()) {
            List<TopicPartition> available = partitions(consumer, topic);
            Set<TopicPartition> availableSet = Set.copyOf(available);
            Map<TopicPartition, List<Long>> offsets = new HashMap<>();
            for (DlqRecordRef reference : requested) {
                TopicPartition partition =
                        new TopicPartition(topic, reference.partition());
                if (!availableSet.contains(partition)) {
                    throw new IllegalArgumentException("DLQ partition does not exist");
                }
                offsets.computeIfAbsent(partition, ignored -> new ArrayList<>())
                        .add(reference.offset());
            }
            List<TopicPartition> assignment = List.copyOf(offsets.keySet());
            consumer.assign(assignment);
            Map<TopicPartition, Long> beginnings = consumer.beginningOffsets(assignment);
            Map<TopicPartition, Long> ends = consumer.endOffsets(assignment);
            offsets.forEach((partition, values) -> {
                values.sort(Long::compare);
                if (values.getFirst() < beginnings.get(partition)
                        || values.getLast() >= ends.get(partition)) {
                    throw new IllegalArgumentException(
                            "DLQ offset is outside retained data");
                }
                consumer.seek(partition, values.getFirst());
            });

            Map<DlqRecordRef, ConsumerRecord<byte[], byte[]>> result = new HashMap<>();
            long deadline = System.nanoTime() + IO_TIMEOUT.toNanos();
            while (result.size() < requested.size() && System.nanoTime() < deadline) {
                var batch = consumer.poll(Duration.ofMillis(100));
                batch.forEach(record -> {
                    DlqRecordRef reference =
                            new DlqRecordRef(record.partition(), record.offset());
                    if (requested.contains(reference)) {
                        result.put(reference, record);
                    }
                });
            }
            if (result.size() != requested.size()) {
                throw new IllegalArgumentException("one or more DLQ offsets were not found");
            }
            return result;
        }
    }

    private List<ConsumerRecord<byte[], byte[]>> pollUntilPositions(
            KafkaConsumer<byte[], byte[]> consumer,
            Map<TopicPartition, Long> ends,
            int maximumRecords) {
        List<ConsumerRecord<byte[], byte[]>> records = new ArrayList<>();
        long deadline = System.nanoTime() + IO_TIMEOUT.toNanos();
        while (!atEnd(consumer, ends)
                && records.size() < maximumRecords
                && System.nanoTime() < deadline) {
            consumer.poll(Duration.ofMillis(100)).forEach(records::add);
        }
        return records;
    }

    private static boolean atEnd(
            KafkaConsumer<byte[], byte[]> consumer, Map<TopicPartition, Long> ends) {
        return ends.entrySet().stream()
                .allMatch(entry -> consumer.position(entry.getKey()) >= entry.getValue());
    }

    private static List<TopicPartition> partitions(
            KafkaConsumer<byte[], byte[]> consumer, String topic) {
        List<TopicPartition> result = consumer.partitionsFor(topic, IO_TIMEOUT).stream()
                .map(info -> new TopicPartition(topic, info.partition()))
                .toList();
        if (result.isEmpty() || result.size() > 500) {
            throw new IllegalArgumentException(
                    "DLQ topic must contain 1..500 partitions");
        }
        return result;
    }

    private static DlqRecordView view(ConsumerRecord<byte[], byte[]> record) {
        return new DlqRecordView(
                record.partition(),
                record.offset(),
                Instant.ofEpochMilli(Math.max(0, record.timestamp())),
                record.key() == null
                        ? null
                        : new String(record.key(), StandardCharsets.UTF_8),
                record.value() == null
                        ? null
                        : Base64.getEncoder().encodeToString(record.value()),
                textHeaders(record));
    }

    private static Map<String, String> textHeaders(
            ConsumerRecord<byte[], byte[]> record) {
        Map<String, String> headers = new LinkedHashMap<>();
        record.headers().forEach(header -> headers.put(
                header.key(),
                header.value() == null
                        ? ""
                        : new String(header.value(), StandardCharsets.UTF_8)));
        return headers;
    }

    private static RecordHeaders replayHeaders(
            ConsumerRecord<byte[], byte[]> record) {
        RecordHeaders headers = new RecordHeaders();
        record.headers().forEach(header -> {
            if (REPLAY_REMOVED_HEADERS.stream()
                    .noneMatch(name -> name.equalsIgnoreCase(header.key()))) {
                headers.add(header);
            }
        });
        return headers;
    }

    private KafkaConsumer<byte[], byte[]> consumer() {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        properties.put(
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
        properties.put(
                ConsumerConfig.MAX_PARTITION_FETCH_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES);
        properties.put(
                ConsumerConfig.FETCH_MAX_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES * 2);
        return new KafkaConsumer<>(properties);
    }

    private static Properties producerProperties(String bootstrapServers) {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_KAFKA_REQUEST_BYTES);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-dlq-replay");
        return properties;
    }

    private static void requireTopic(String topic) {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("Kafka topic must not be blank");
        }
    }
}
