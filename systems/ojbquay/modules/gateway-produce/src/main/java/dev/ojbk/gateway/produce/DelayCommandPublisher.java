package dev.ojbk.gateway.produce;

import dev.ojbk.delay.DelayCommand;

@FunctionalInterface
public interface DelayCommandPublisher extends AutoCloseable {
    void publish(DelayCommand command);

    @Override
    default void close() {}
}
