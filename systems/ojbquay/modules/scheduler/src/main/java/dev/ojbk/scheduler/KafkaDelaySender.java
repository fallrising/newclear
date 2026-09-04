package dev.ojbk.scheduler;

import dev.ojbk.messaging.MessageLimits;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;

public final class KafkaDelaySender implements DelaySender, AutoCloseable {
    private final KafkaProducer<String, byte[]> producer;

    public KafkaDelaySender(String bootstrapServers) {
        producer = new KafkaProducer<>(properties(bootstrapServers));
    }

    @Override
    public void send(DelayDelivery delivery) {
        RecordHeaders headers = new RecordHeaders();
        delivery.headers().forEach((name, value) ->
                headers.add(name, value.getBytes(StandardCharsets.UTF_8)));
        if (!delivery.tags().isEmpty()) {
            headers.add(
                    "x-ojbk-tags",
                    String.join(",", delivery.tags()).getBytes(StandardCharsets.UTF_8));
        }
        headers.add(
                "x-ojbk-delay-id", delivery.delayId().getBytes(StandardCharsets.UTF_8));
        ProducerRecord<String, byte[]> record = new ProducerRecord<>(
                delivery.topic(),
                delivery.partition(),
                null,
                delivery.key(),
                delivery.value(),
                headers);
        try {
            producer.send(record).get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("scheduled Kafka send was interrupted", interrupted);
        } catch (ExecutionException execution) {
            throw new IllegalStateException(
                    "scheduled Kafka send failed", execution.getCause());
        }
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(10));
    }

    private static Properties properties(String bootstrapServers) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_KAFKA_REQUEST_BYTES);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-delay-dispatcher");
        return properties;
    }
}
