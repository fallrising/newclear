package dev.ojbk.console.delay;

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

public final class KafkaDelayCancellationPublisher
        implements DelayCancellationPublisher {
    private final KafkaProducer<String, byte[]> producer;
    private final DelayCommandCodec codec = new DelayCommandCodec();

    public KafkaDelayCancellationPublisher(String bootstrapServers) {
        producer = new KafkaProducer<>(properties(bootstrapServers));
    }

    @Override
    public void publish(DelayCommand command) {
        if (command.action() != dev.ojbk.delay.DelayAction.CANCEL) {
            throw new IllegalArgumentException(
                    "console delay publisher accepts cancellation only");
        }
        try {
            producer.send(new ProducerRecord<>(
                            DelayCommand.INBOX_TOPIC,
                            command.delayId(),
                            codec.encode(command)))
                    .get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "delay cancellation was interrupted", interrupted);
        } catch (ExecutionException failure) {
            throw new IllegalStateException(
                    "delay cancellation publication failed",
                    failure.getCause());
        }
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(10));
    }

    private static Properties properties(String bootstrapServers) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException(
                    "bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(
                ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(
                ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG,
                StringSerializer.class);
        properties.put(
                ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG,
                ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_DELAY_COMMAND_BYTES);
        properties.put(
                ProducerConfig.CLIENT_ID_CONFIG,
                "ojbquay-console-delay-cancel");
        return properties;
    }
}
