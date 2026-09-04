package dev.ojbk.gateway.consume;

import dev.ojbk.delay.DelayAction;
import dev.ojbk.delay.DelayCommand;
import dev.ojbk.delay.DelayCommandCodec;
import dev.ojbk.delay.Ids;
import dev.ojbk.messaging.MessageLimits;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringSerializer;

public final class KafkaRetryPublisher implements RetryPublisher {
    private static final String ORIGIN_TOPIC = "x-ojbk-origin-topic";
    private static final String ORIGIN_PARTITION = "x-ojbk-origin-partition";
    private static final String ORIGIN_OFFSET = "x-ojbk-origin-offset";
    private static final String RETRY_COUNT = "x-ojbk-retry";
    private static final String TAGS = "x-ojbk-tags";
    private static final String DLQ_REASON = "x-ojbk-dlq-reason";

    private final KafkaProducer<String, byte[]> producer;
    private final DelayCommandCodec codec = new DelayCommandCodec();

    public KafkaRetryPublisher(String bootstrapServers) {
        producer = new KafkaProducer<>(properties(bootstrapServers));
    }

    @Override
    public void schedule(
            PushMessage message,
            String retryTopic,
            Instant dueAt,
            int nextRetryCount) {
        Map<String, String> headers = retryHeaders(message, nextRetryCount);
        String delayId = Ids.uuidV7();
        DelayCommand command = new DelayCommand(
                DelayCommand.SUPPORTED_SCHEMA_VERSION,
                DelayAction.ADD,
                delayId,
                retryTopic,
                dueAt.toEpochMilli(),
                message.value(),
                message.key(),
                message.tags(),
                headers,
                message.partition(),
                null,
                1,
                null);
        send(new ProducerRecord<>(
                DelayCommand.INBOX_TOPIC, delayId, codec.encode(command)));
    }

    @Override
    public void publishDlq(PushMessage message, String dlqTopic, String reason) {
        Map<String, String> headers = retryHeaders(message, message.retryCount());
        headers.put(DLQ_REASON, requireText(reason, "reason"));
        RecordHeaders kafkaHeaders = new RecordHeaders();
        headers.forEach((name, value) -> kafkaHeaders.add(
                name, value.getBytes(StandardCharsets.UTF_8)));
        send(new ProducerRecord<>(
                dlqTopic,
                message.partition(),
                message.timestamp().toEpochMilli(),
                message.key(),
                message.value(),
                kafkaHeaders));
    }

    @Override
    public void close() {
        producer.close(Duration.ofSeconds(10));
    }

    private static Map<String, String> retryHeaders(
            PushMessage message, int nextRetryCount) {
        if (nextRetryCount < 0) {
            throw new IllegalArgumentException("nextRetryCount must not be negative");
        }
        Map<String, String> headers = new LinkedHashMap<>(message.headers());
        headers.remove("x-ojbk-delay-id");
        headers.putIfAbsent(ORIGIN_TOPIC, message.originTopic());
        headers.putIfAbsent(ORIGIN_PARTITION, Integer.toString(message.partition()));
        headers.putIfAbsent(ORIGIN_OFFSET, Long.toString(message.offset()));
        headers.put(RETRY_COUNT, Integer.toString(nextRetryCount));
        if (!message.tags().isEmpty()) {
            headers.put(TAGS, String.join(",", message.tags()));
        }
        return headers;
    }

    private void send(ProducerRecord<String, byte[]> record) {
        try {
            producer.send(record).get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("retry publication was interrupted", interrupted);
        } catch (ExecutionException execution) {
            throw new IllegalStateException(
                    "retry publication failed", execution.getCause());
        }
    }

    private static Properties properties(String bootstrapServers) {
        requireText(bootstrapServers, "bootstrapServers");
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
        properties.put(ProducerConfig.ACKS_CONFIG, "all");
        properties.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "zstd");
        properties.put(
                ProducerConfig.MAX_REQUEST_SIZE_CONFIG,
                MessageLimits.MAX_DELAY_COMMAND_BYTES);
        properties.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120_000);
        properties.put(ProducerConfig.CLIENT_ID_CONFIG, "ojbquay-consume-retry-publisher");
        return properties;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
