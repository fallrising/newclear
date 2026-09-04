package dev.ojbk.console.kafka;

import dev.ojbk.config.TopicConfig;

public interface KafkaAdminOperations {
    void createTopic(TopicConfig topic, String compression);

    void createInternalTopic(String name, int partitions, long retentionMs);

    default void configureShareGroup(String group, int recordLockDurationMs) {}

    void updateTopicConfig(
            String name, int maxMessageBytes, long retentionMs, String compression);

    void deleteTopic(String name);
}
