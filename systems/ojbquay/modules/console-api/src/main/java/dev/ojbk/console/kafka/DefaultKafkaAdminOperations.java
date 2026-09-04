package dev.ojbk.console.kafka;

import dev.ojbk.config.KafkaConfigPublisher;
import dev.ojbk.config.TopicConfig;
import dev.ojbk.delay.DelayCommand;
import dev.ojbk.messaging.MessageLimits;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AlterConfigOp;
import org.apache.kafka.clients.admin.ConfigEntry;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.config.ConfigResource;

public final class DefaultKafkaAdminOperations implements KafkaAdminOperations {
    private final Admin admin;
    private final short internalReplicationFactor;

    DefaultKafkaAdminOperations(Admin admin, short internalReplicationFactor) {
        this.admin = admin;
        this.internalReplicationFactor = internalReplicationFactor;
    }

    @Override
    public void createInternalTopic(String name, int partitions, long retentionMs) {
        NewTopic newTopic = new NewTopic(name, partitions, internalReplicationFactor)
                .configs(Map.of(
                        "retention.ms", Long.toString(retentionMs),
                        "compression.type", "zstd",
                        "max.message.bytes",
                                Integer.toString(MessageLimits.MAX_KAFKA_REQUEST_BYTES)));
        await(admin.createTopics(List.of(newTopic)).all(), "internal topic creation failed");
    }

    @Override
    public void configureShareGroup(String group, int recordLockDurationMs) {
        if (group == null || group.isBlank()) {
            throw new IllegalArgumentException("share group must not be blank");
        }
        if (recordLockDurationMs < 1_000 || recordLockDurationMs > 300_000) {
            throw new IllegalArgumentException(
                    "share record lock duration must be 1000..300000");
        }
        ConfigResource resource = new ConfigResource(ConfigResource.Type.GROUP, group);
        await(
                admin.incrementalAlterConfigs(Map.of(
                                resource,
                                List.of(
                                        set("share.auto.offset.reset", "earliest"),
                                        set(
                                                "share.record.lock.duration.ms",
                                                Integer.toString(
                                                        recordLockDurationMs)))))
                        .all(),
                "share group configuration failed");
    }

    @Override
    public void createTopic(TopicConfig topic, String compression) {
        NewTopic newTopic =
                new NewTopic(topic.name(), topic.partitions(), (short) topic.replication())
                        .configs(Map.of(
                                "retention.ms", Long.toString(topic.retentionMs()),
                                "max.message.bytes",
                                        Integer.toString(MessageLimits.kafkaRecordLimit(
                                                topic.maxMessageBytes())),
                                "compression.type", compression));
        await(admin.createTopics(List.of(newTopic)).all(), "topic creation failed");
    }

    @Override
    public void updateTopicConfig(
            String name, int maxMessageBytes, long retentionMs, String compression) {
        ConfigResource resource = new ConfigResource(ConfigResource.Type.TOPIC, name);
        List<AlterConfigOp> operations = List.of(
                set(
                        "max.message.bytes",
                        Integer.toString(MessageLimits.kafkaRecordLimit(maxMessageBytes))),
                set("retention.ms", Long.toString(retentionMs)),
                set("compression.type", compression));
        await(
                admin.incrementalAlterConfigs(Map.of(resource, operations)).all(),
                "topic configuration update failed");
    }

    @Override
    public void deleteTopic(String name) {
        await(admin.deleteTopics(List.of(name)).all(), "topic deletion failed");
    }

    public void ensureConfigTopic() {
        ensure(new NewTopic(KafkaConfigPublisher.CONFIG_TOPIC, 1, internalReplicationFactor)
                .configs(Map.of("cleanup.policy", "compact", "retention.ms", "-1")));
    }

    public void ensureDelayInbox() {
        ensure(new NewTopic(DelayCommand.INBOX_TOPIC, 12, internalReplicationFactor)
                .configs(Map.of(
                        "cleanup.policy", "delete",
                        "retention.ms", Long.toString(7L * 24 * 60 * 60 * 1_000),
                        "compression.type", "zstd",
                        "max.message.bytes",
                                Integer.toString(MessageLimits.MAX_DELAY_COMMAND_BYTES))));
    }

    private void ensure(NewTopic topic) {
        try {
            admin.createTopics(List.of(topic)).all().get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("platform topic creation was interrupted", interrupted);
        } catch (ExecutionException execution) {
            if (!(execution.getCause()
                    instanceof org.apache.kafka.common.errors.TopicExistsException)) {
                throw new IllegalStateException(
                        "platform topic creation failed", execution.getCause());
            }
        }
    }

    private static void await(
            org.apache.kafka.common.KafkaFuture<Void> future, String failureMessage) {
        try {
            future.get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(failureMessage, interrupted);
        } catch (ExecutionException execution) {
            throw new IllegalStateException(failureMessage, execution.getCause());
        }
    }

    private static AlterConfigOp set(String name, String value) {
        return new AlterConfigOp(new ConfigEntry(name, value), AlterConfigOp.OpType.SET);
    }
}
