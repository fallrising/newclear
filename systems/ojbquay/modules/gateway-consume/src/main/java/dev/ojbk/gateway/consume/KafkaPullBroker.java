package dev.ojbk.gateway.consume;

import dev.ojbk.config.PullSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import dev.ojbk.messaging.MessageLimits;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AlterConfigOp;
import org.apache.kafka.clients.admin.ConfigEntry;
import org.apache.kafka.clients.consumer.AcknowledgeType;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaShareConsumer;
import org.apache.kafka.clients.consumer.ShareConsumer;
import org.apache.kafka.common.KafkaException;
import org.apache.kafka.common.config.ConfigResource;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;

final class KafkaPullBroker implements PullBroker {
    private final ShareConsumer<byte[], byte[]> consumer;
    private final AtomicBoolean closed = new AtomicBoolean();
    private Map<PullRecordId, ConsumerRecord<byte[], byte[]>> previous = Map.of();

    KafkaPullBroker(String bootstrapServers, SubscriptionConfig subscription) {
        PullSubscriptionSpec spec = PullSubscriptionSpec.from(subscription.spec());
        Properties properties = properties(
                bootstrapServers, subscription, spec.maxInflight());
        configureGroup(properties, subscription.group(), spec.ackTimeoutMs());
        consumer = new KafkaShareConsumer<>(properties);
        consumer.subscribe(List.of(subscription.topic()));
    }

    KafkaPullBroker(ShareConsumer<byte[], byte[]> consumer, String topic) {
        this.consumer = java.util.Objects.requireNonNull(consumer, "consumer");
        consumer.subscribe(List.of(topic));
    }

    @Override
    public List<PullBrokerRecord> poll(Duration timeout) {
        if (!previous.isEmpty()) {
            throw new IllegalStateException(
                    "previous pull records must be settled before polling");
        }
        Map<PullRecordId, ConsumerRecord<byte[], byte[]>> fetched =
                new LinkedHashMap<>();
        consumer.poll(timeout).forEach(record -> {
            PullRecordId id =
                    new PullRecordId(record.topic(), record.partition(), record.offset());
            if (fetched.put(id, record) != null) {
                throw new IllegalStateException(
                        "share poll returned a duplicate record identity");
            }
        });
        previous = Map.copyOf(fetched);
        return fetched.values().stream()
                .map(record -> new PullBrokerRecord(PushMessage.from(record)))
                .toList();
    }

    @Override
    public void settle(Map<PullRecordId, PullDisposition> dispositions) {
        Map<PullRecordId, PullDisposition> requested = Map.copyOf(dispositions);
        if (!requested.keySet().equals(previous.keySet())) {
            throw new IllegalArgumentException(
                    "every record from the previous poll must be settled");
        }
        requested.forEach((id, disposition) ->
                consumer.acknowledge(previous.get(id), type(disposition)));
        Map<org.apache.kafka.common.TopicIdPartition, Optional<KafkaException>> results =
                consumer.commitSync(Duration.ofSeconds(5));
        Optional<KafkaException> failure = results.values().stream()
                .flatMap(Optional::stream)
                .findFirst();
        if (failure.isPresent()) {
            throw new IllegalStateException(
                    "share acknowledgement commit failed", failure.orElseThrow());
        }
        previous = Map.of();
    }

    @Override
    public void wakeup() {
        consumer.wakeup();
    }

    @Override
    public void close() {
        if (closed.compareAndSet(false, true)) {
            consumer.close(Duration.ofSeconds(5));
        }
    }

    private static AcknowledgeType type(PullDisposition disposition) {
        return switch (disposition) {
            case ACCEPT -> AcknowledgeType.ACCEPT;
            case RELEASE -> AcknowledgeType.RELEASE;
            case REJECT -> AcknowledgeType.REJECT;
            case RENEW -> AcknowledgeType.RENEW;
        };
    }

    private static Properties properties(
            String bootstrapServers,
            SubscriptionConfig subscription,
            int maxInflight) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException(
                    "bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, subscription.group());
        properties.put(
                ConsumerConfig.CLIENT_ID_CONFIG,
                "ojbquay-pull-" + subscription.id());
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, maxInflight);
        properties.put("share.acknowledgement.mode", "explicit");
        properties.put("share.acquire.mode", "record_limit");
        properties.put(
                ConsumerConfig.MAX_PARTITION_FETCH_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES);
        properties.put(
                ConsumerConfig.FETCH_MAX_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES * 2);
        properties.put(
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG,
                ByteArrayDeserializer.class);
        properties.put(
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG,
                ByteArrayDeserializer.class);
        return properties;
    }

    private static void configureGroup(
            Properties properties, String group, int ackTimeoutMs) {
        ConfigResource resource =
                new ConfigResource(ConfigResource.Type.GROUP, group);
        List<AlterConfigOp> changes = List.of(
                new AlterConfigOp(
                        new ConfigEntry("share.auto.offset.reset", "earliest"),
                        AlterConfigOp.OpType.SET),
                new AlterConfigOp(
                        new ConfigEntry(
                                "share.record.lock.duration.ms",
                                Integer.toString(ackTimeoutMs)),
                        AlterConfigOp.OpType.SET));
        try (Admin admin = Admin.create(properties)) {
            admin.incrementalAlterConfigs(Map.of(resource, changes))
                    .all()
                    .get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "share group initialization was interrupted", interrupted);
        } catch (ExecutionException failure) {
            throw new IllegalStateException(
                    "share group initialization failed", failure.getCause());
        }
    }
}
