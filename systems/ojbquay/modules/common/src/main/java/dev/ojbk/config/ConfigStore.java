package dev.ojbk.config;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.List;
import java.util.Comparator;
import java.util.concurrent.atomic.AtomicReference;

public final class ConfigStore {
    public static final int SUPPORTED_SCHEMA_VERSION = 1;

    private final AtomicReference<Map<ConfigKey, ConfigEvent>> active =
            new AtomicReference<>(Map.of());

    public ApplyResult apply(ConfigEvent event) {
        if (event.schemaVersion() != SUPPORTED_SCHEMA_VERSION) {
            return ApplyResult.UNSUPPORTED_SCHEMA;
        }
        try {
            validatePayload(event);
        } catch (IllegalArgumentException invalid) {
            return ApplyResult.INVALID_PAYLOAD;
        }

        ConfigKey key = new ConfigKey(event.entityType(), event.entityId());
        while (true) {
            Map<ConfigKey, ConfigEvent> current = active.get();
            ConfigEvent existing = current.get(key);
            if (existing != null && existing.version() >= event.version()) {
                return ApplyResult.STALE;
            }

            Map<ConfigKey, ConfigEvent> replacement = new HashMap<>(current);
            replacement.put(key, event);
            if (active.compareAndSet(current, Map.copyOf(replacement))) {
                return ApplyResult.APPLIED;
            }
        }
    }

    public Optional<ConfigEvent> get(ConfigEntityType type, String entityId) {
        return Optional.ofNullable(active.get().get(new ConfigKey(type, entityId)));
    }

    public Map<ConfigKey, ConfigEvent> snapshot() {
        return active.get();
    }

    public Optional<ConfigEvent> delete(ConfigEntityType type, String entityId) {
        ConfigKey key = new ConfigKey(type, entityId);
        while (true) {
            Map<ConfigKey, ConfigEvent> current = active.get();
            ConfigEvent existing = current.get(key);
            if (existing == null) {
                return Optional.empty();
            }
            Map<ConfigKey, ConfigEvent> replacement = new HashMap<>(current);
            replacement.remove(key);
            if (active.compareAndSet(current, Map.copyOf(replacement))) {
                return Optional.of(existing);
            }
        }
    }

    public Map<ConfigKey, ConfigEvent> all() {
        return snapshot();
    }

    public Optional<TopicConfig> topic(String name) {
        return get(ConfigEntityType.TOPIC, name).map(ConfigStore::topic);
    }

    public Optional<GroupConfig> group(String name) {
        return get(ConfigEntityType.GROUP, name).map(ConfigStore::group);
    }

    public List<SubscriptionConfig> subscriptionsByGroup(String groupName) {
        return active.get().entrySet().stream()
                .filter(entry -> entry.getKey().type() == ConfigEntityType.SUBSCRIPTION)
                .map(Map.Entry::getValue)
                .map(ConfigStore::subscription)
                .filter(subscription -> subscription.group().equals(groupName))
                .sorted(Comparator.comparingLong(SubscriptionConfig::id))
                .toList();
    }

    public Optional<SubscriptionConfig> subscription(String entityId) {
        return get(ConfigEntityType.SUBSCRIPTION, entityId)
                .map(ConfigStore::subscription);
    }

    public enum ApplyResult {
        APPLIED,
        STALE,
        UNSUPPORTED_SCHEMA,
        INVALID_PAYLOAD
    }

    public record ConfigKey(ConfigEntityType type, String entityId) {
        public ConfigKey {
            if (type == null) {
                throw new IllegalArgumentException("type must not be null");
            }
            if (entityId == null || entityId.isBlank()) {
                throw new IllegalArgumentException("entityId must not be blank");
            }
        }
    }

    private static void validatePayload(ConfigEvent event) {
        switch (event.entityType()) {
            case TOPIC -> topic(event);
            case GROUP -> group(event);
            case SUBSCRIPTION -> subscription(event);
            case KAFKA_CLUSTER -> {
                if (event.payload().isEmpty()) {
                    throw new IllegalArgumentException("cluster payload must not be empty");
                }
            }
        }
    }

    private static TopicConfig topic(ConfigEvent event) {
        Map<String, Object> payload = event.payload();
        return new TopicConfig(
                text(payload, "name"),
                number(payload, "clusterId").longValue(),
                number(payload, "partitions").intValue(),
                number(payload, "replication").intValue(),
                bool(payload, "delayTopic"),
                number(payload, "maxMessageBytes").intValue(),
                number(payload, "retentionMs").longValue(),
                number(payload, "produceQuotaTps").intValue(),
                text(payload, "token"),
                text(payload, "owner"),
                bool(payload, "enabled"));
    }

    private static GroupConfig group(ConfigEvent event) {
        Map<String, Object> payload = event.payload();
        return new GroupConfig(
                text(payload, "name"),
                text(payload, "token"),
                text(payload, "owner"),
                bool(payload, "enabled"));
    }

    private static SubscriptionConfig subscription(ConfigEvent event) {
        Map<String, Object> payload = event.payload();
        Object rawSpec = payload.get("spec");
        if (!(rawSpec instanceof Map<?, ?> values)) {
            throw new IllegalArgumentException("config field spec must be an object");
        }
        Map<String, Object> spec = new HashMap<>();
        values.forEach((key, value) -> {
            if (!(key instanceof String textKey)) {
                throw new IllegalArgumentException("config spec keys must be strings");
            }
            spec.put(textKey, value);
        });
        return new SubscriptionConfig(
                number(payload, "id").longValue(),
                text(payload, "group"),
                text(payload, "topic"),
                text(payload, "owner"),
                bool(payload, "enabled"),
                spec);
    }

    private static String text(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("config field " + field + " must be text");
        }
        return text;
    }

    private static Number number(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof Number number)) {
            throw new IllegalArgumentException("config field " + field + " must be numeric");
        }
        return number;
    }

    private static boolean bool(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (!(value instanceof Boolean bool)) {
            throw new IllegalArgumentException("config field " + field + " must be boolean");
        }
        return bool;
    }

}
