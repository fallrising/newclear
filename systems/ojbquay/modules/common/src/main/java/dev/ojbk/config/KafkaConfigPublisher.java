package dev.ojbk.config;

import java.time.Duration;
import java.util.Objects;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;

public final class KafkaConfigPublisher implements ConfigPublisher, AutoCloseable {
    public static final String CONFIG_TOPIC = "__ojbk.config";

    private final KafkaProducer<String, byte[]> producer;
    private final ConfigEventCodec codec;

    public KafkaConfigPublisher(String bootstrapServers) {
        this(producerProperties(bootstrapServers), new ConfigEventCodec());
    }

    KafkaConfigPublisher(Properties properties, ConfigEventCodec codec) {
        producer = new KafkaProducer<>(properties);
        this.codec = codec;
    }

    @Override
    public void publish(ConfigEvent event) {
        Objects.requireNonNull(event, "event");
        String key = event.entityType() + ":" + event.entityId();
        send(key, codec.encode(event));
    }

    @Override
    public void delete(ConfigEntityType entityType, String entityId) {
        Objects.requireNonNull(entityType, "entityType");
        if (entityId == null || entityId.isBlank()) {
            throw new IllegalArgumentException("entityId must not be blank");
        }
        send(entityType + ":" + entityId, null);
    }

    private void send(String key, byte[] value) {
        try {
            producer.send(new ProducerRecord<>(CONFIG_TOPIC, key, value)).get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("config publication was interrupted", interrupted);
        } catch (ExecutionException exception) {
            throw new IllegalStateException("config publication failed", exception.getCause());
        }
    }

    private static Properties producerProperties(String bootstrapServers) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-config-publisher");
        return properties;
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(5));
    }
}
