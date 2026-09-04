package dev.ojbk.console.delay;

import dev.ojbk.delay.DelayCommand;

@FunctionalInterface
public interface DelayCancellationPublisher extends AutoCloseable {
    void publish(DelayCommand command);

    @Override
    default void close() {}
}
