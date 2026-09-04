package dev.ojbk.config;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.BiConsumer;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.WakeupException;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;

public final class KafkaConfigBusClient implements ConfigBusClient {
    private static final Duration POLL_TIMEOUT = Duration.ofMillis(250);

    private final KafkaConsumer<String, byte[]> consumer;
    private final ConfigStore store;
    private final ConfigEventCodec codec;
    private final List<Consumer<ConfigEvent>> listeners = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<ConfigEntityType, String>> deletionListeners =
            new CopyOnWriteArrayList<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean ready = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private volatile Thread worker;

    public KafkaConfigBusClient(
            String bootstrapServers,
            String service,
            String instanceId,
            ConfigStore store) {
        this(properties(bootstrapServers, service, instanceId), store, new ConfigEventCodec());
    }

    KafkaConfigBusClient(
            Properties properties, ConfigStore store, ConfigEventCodec codec) {
        this.consumer = new KafkaConsumer<>(properties);
        this.store = java.util.Objects.requireNonNull(store, "store");
        this.codec = java.util.Objects.requireNonNull(codec, "codec");
    }

    @Override
    public void start() {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("config bus client can only be started once");
        }
        running.set(true);
        worker = Thread.ofVirtual().name("ojbquay-config-bus").start(this::poll);
    }

    @Override
    public boolean ready() {
        return ready.get();
    }

    @Override
    public Optional<String> lastError() {
        return Optional.ofNullable(lastError.get());
    }

    @Override
    public void addListener(Consumer<ConfigEvent> listener) {
        listeners.add(java.util.Objects.requireNonNull(listener, "listener"));
    }

    @Override
    public void addDeletionListener(BiConsumer<ConfigEntityType, String> listener) {
        deletionListeners.add(java.util.Objects.requireNonNull(listener, "listener"));
    }

    private void poll() {
        Set<TopicPartition> bootstrapAssignment = Set.of();
        Map<TopicPartition, Long> bootstrapEndOffsets = Map.of();
        try {
            consumer.subscribe(List.of(KafkaConfigPublisher.CONFIG_TOPIC));
            while (running.get()) {
                var records = consumer.poll(POLL_TIMEOUT);
                records.forEach(record -> apply(record.key(), record.value()));

                if (!ready.get()) {
                    Set<TopicPartition> assignment = Set.copyOf(consumer.assignment());
                    if (!assignment.isEmpty() && !assignment.equals(bootstrapAssignment)) {
                        bootstrapAssignment = assignment;
                        bootstrapEndOffsets = Map.copyOf(consumer.endOffsets(assignment));
                    }
                    if (!bootstrapEndOffsets.isEmpty()
                            && hasReachedBootstrapEnd(bootstrapEndOffsets)) {
                        ready.set(true);
                    }
                }
            }
        } catch (WakeupException wakeup) {
            if (running.get()) {
                recordFailure(wakeup);
            }
        } catch (RuntimeException failure) {
            recordFailure(failure);
        } finally {
            consumer.close();
        }
    }

    private void apply(String key, byte[] encoded) {
        if (encoded == null) {
            ConfigStore.ConfigKey configKey = parseKey(key);
            store.delete(configKey.type(), configKey.entityId());
            for (BiConsumer<ConfigEntityType, String> listener : deletionListeners) {
                listener.accept(configKey.type(), configKey.entityId());
            }
            return;
        }
        ConfigEvent event = codec.decode(encoded);
        if (store.apply(event) == ConfigStore.ApplyResult.APPLIED) {
            for (Consumer<ConfigEvent> listener : listeners) {
                listener.accept(event);
            }
        }
    }

    private static ConfigStore.ConfigKey parseKey(String key) {
        if (key == null) {
            throw new IllegalArgumentException("config tombstone key must not be null");
        }
        String[] parts = key.split(":", 2);
        if (parts.length != 2 || parts[1].isBlank()) {
            throw new IllegalArgumentException("invalid config tombstone key");
        }
        try {
            return new ConfigStore.ConfigKey(ConfigEntityType.valueOf(parts[0]), parts[1]);
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException("invalid config tombstone key", invalid);
        }
    }

    private boolean hasReachedBootstrapEnd(Map<TopicPartition, Long> endOffsets) {
        for (Map.Entry<TopicPartition, Long> entry : endOffsets.entrySet()) {
            if (consumer.position(entry.getKey()) < entry.getValue()) {
                return false;
            }
        }
        return true;
    }

    private void recordFailure(RuntimeException failure) {
        ready.set(false);
        lastError.set(failure.getClass().getSimpleName());
    }

    @Override
    public void close() {
        running.set(false);
        if (started.get()) {
            consumer.wakeup();
            Thread activeWorker = worker;
            if (activeWorker != null) {
                try {
                    activeWorker.join(Duration.ofSeconds(5));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        } else {
            consumer.close();
        }
    }

    private static Properties properties(
            String bootstrapServers, String service, String instanceId) {
        requireText(bootstrapServers, "bootstrapServers");
        requireText(service, "service");
        requireText(instanceId, "instanceId");
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, "ojbk.cfg." + service + "." + instanceId);
        properties.put(ConsumerConfig.CLIENT_ID_CONFIG, service + "-" + instanceId + "-config");
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 500);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return properties;
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
