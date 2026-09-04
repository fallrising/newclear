package dev.ojbk.scheduler;

import dev.ojbk.delay.DelayCommand;
import dev.ojbk.delay.DelayCommandCodec;
import dev.ojbk.messaging.MessageLimits;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Properties;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;

public final class KafkaDelayIngestor implements AutoCloseable {
    public static final String GROUP_ID = "ojbk.scheduler.ingest";

    private final KafkaConsumer<String, byte[]> consumer;
    private final DelayRepository repository;
    private final DelayCommandCodec codec = new DelayCommandCodec();
    private final SchedulerMetrics metrics;

    public KafkaDelayIngestor(
            String bootstrapServers, String instanceId, DelayRepository repository) {
        this(bootstrapServers, instanceId, repository, new SchedulerMetrics());
    }

    KafkaDelayIngestor(
            String bootstrapServers,
            String instanceId,
            DelayRepository repository,
            SchedulerMetrics metrics) {
        this.consumer = new KafkaConsumer<>(properties(bootstrapServers, instanceId));
        this.repository = Objects.requireNonNull(repository, "repository");
        this.metrics = Objects.requireNonNull(metrics, "metrics");
        consumer.subscribe(List.of(DelayCommand.INBOX_TOPIC));
    }

    public int pollOnce(Duration timeout) {
        Objects.requireNonNull(timeout, "timeout");
        if (timeout.isNegative()) {
            throw new IllegalArgumentException("poll timeout must not be negative");
        }
        var records = consumer.poll(timeout);
        if (records.isEmpty()) {
            return 0;
        }
        try {
            List<DelayCommand> commands = new ArrayList<>(records.count());
            records.forEach(record -> commands.add(codec.decode(record.value())));
            repository.applyBatch(commands);
            consumer.commitSync();
            metrics.recordIngested(commands.size());
            return commands.size();
        } catch (RuntimeException failure) {
            try {
                records.partitions().forEach(partition ->
                        consumer.seek(
                                partition,
                                records.records(partition).getFirst().offset()));
            } catch (RuntimeException rewindFailure) {
                failure.addSuppressed(rewindFailure);
            }
            metrics.recordFailure();
            throw failure;
        }
    }

    public void wakeup() {
        consumer.wakeup();
    }

    @Override
    public void close() {
        consumer.close();
    }

    private static Properties properties(String bootstrapServers, String instanceId) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        if (instanceId == null || instanceId.isBlank()) {
            throw new IllegalArgumentException("instanceId must not be blank");
        }
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, GROUP_ID);
        properties.put(ConsumerConfig.CLIENT_ID_CONFIG, "ojbquay-scheduler-" + instanceId);
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, JdbcDelayRepository.MAX_BATCH);
        properties.put(
                ConsumerConfig.MAX_PARTITION_FETCH_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES);
        properties.put(
                ConsumerConfig.FETCH_MAX_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return properties;
    }
}
