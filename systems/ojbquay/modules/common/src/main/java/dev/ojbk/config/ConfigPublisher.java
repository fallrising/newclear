package dev.ojbk.config;

public interface ConfigPublisher {
    void publish(ConfigEvent event);

    void delete(ConfigEntityType entityType, String entityId);
}
