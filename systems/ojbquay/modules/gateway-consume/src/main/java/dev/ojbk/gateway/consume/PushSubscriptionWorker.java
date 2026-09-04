package dev.ojbk.gateway.consume;

import java.util.Optional;

public interface PushSubscriptionWorker extends AutoCloseable {
    void start();

    boolean running();

    Optional<String> lastError();

    long acceptedCount();

    @Override
    void close();
}
