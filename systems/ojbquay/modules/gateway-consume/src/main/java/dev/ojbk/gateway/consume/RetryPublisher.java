package dev.ojbk.gateway.consume;

import java.time.Instant;

public interface RetryPublisher extends AutoCloseable {
    void schedule(
            PushMessage message,
            String retryTopic,
            Instant dueAt,
            int nextRetryCount);

    void publishDlq(PushMessage message, String dlqTopic, String reason);

    @Override
    default void close() {}
}
