package dev.ojbk.gateway.produce;

import dev.ojbk.delay.DelayCommand;
import dev.ojbk.delay.DelayCommandCodec;
import dev.ojbk.messaging.MessageLimits;
import java.time.Duration;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;

public final class KafkaDelayCommandPublisher implements DelayCommandPublisher {
    private final KafkaProducer<String, byte[]> producer;
    private final DelayCommandCodec codec = new DelayCommandCodec();

    public KafkaDelayCommandPublisher(String bootstrapServers) {
        this.producer = new KafkaProducer<>(properties(bootstrapServers));
    }

    @Override
    public void publish(DelayCommand command) {
        try {
            producer.send(new ProducerRecord<>(
                            DelayCommand.INBOX_TOPIC, command.delayId(), codec.encode(command)))
                    .get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("delay command publication was interrupted", interrupted);
        } catch (ExecutionException execution) {
            throw new IllegalStateException(
                    "delay command publication failed", execution.getCause());
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
        // JSON base64 expands the accepted 4 MiB application payload.
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_DELAY_COMMAND_BYTES);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-delay-command-publisher");
        return properties;
    }
}
