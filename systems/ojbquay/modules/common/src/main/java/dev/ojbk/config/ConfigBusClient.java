package dev.ojbk.config;

import java.util.Optional;
import java.util.function.Consumer;
import java.util.function.BiConsumer;

public interface ConfigBusClient extends AutoCloseable {
    void start();

    boolean ready();

    Optional<String> lastError();

    void addListener(Consumer<ConfigEvent> listener);

    void addDeletionListener(BiConsumer<ConfigEntityType, String> listener);

    @Override
    void close();
}
