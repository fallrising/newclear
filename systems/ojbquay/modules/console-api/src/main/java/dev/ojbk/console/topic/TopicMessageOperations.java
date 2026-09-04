package dev.ojbk.console.topic;

import java.util.List;

public interface TopicMessageOperations extends AutoCloseable {
    List<TopicSample> sample(
            String topic,
            int partitions,
            int maximum,
            boolean redact,
            String cel);

    TestMessageResult publish(String topic, PreparedTestMessage message);

    @Override
    default void close() {}
}
