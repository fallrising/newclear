package dev.ojbk.gateway.produce;

import dev.ojbk.messaging.MessageLimits;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeader;
import org.apache.kafka.common.serialization.ByteArraySerializer;

public final class KafkaBrokerProducer implements BrokerProducer {
    private final KafkaProducer<byte[], byte[]> producer;

    public KafkaBrokerProducer(String bootstrapServers) {
        this(properties(bootstrapServers));
    }

    KafkaBrokerProducer(Properties properties) {
        this.producer = new KafkaProducer<>(properties);
    }

    @Override
    public BrokerAck send(BrokerRecord record) {
        Iterable<org.apache.kafka.common.header.Header> headers = record.headers().entrySet().stream()
                .map(entry -> new RecordHeader(
                        entry.getKey(), entry.getValue().getBytes(StandardCharsets.UTF_8)))
                .map(org.apache.kafka.common.header.Header.class::cast)
                .toList();
        byte[] key = record.key() == null
                ? null
                : record.key().getBytes(StandardCharsets.UTF_8);
        ProducerRecord<byte[], byte[]> kafkaRecord = new ProducerRecord<>(
                record.topic(),
                record.partition(),
                null,
                key,
                record.value(),
                headers);
        try {
            var metadata = producer.send(kafkaRecord).get();
            return new BrokerAck(metadata.topic(), metadata.partition(), metadata.offset());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("broker send was interrupted", interrupted);
        } catch (ExecutionException execution) {
            throw new IllegalStateException("broker send failed", execution.getCause());
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
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.LINGER_MS_CONFIG, 5);
        properties.put(ProducerConfig.BATCH_SIZE_CONFIG, 131_072);
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_KAFKA_REQUEST_BYTES);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-gateway-produce");
        return properties;
    }
}
