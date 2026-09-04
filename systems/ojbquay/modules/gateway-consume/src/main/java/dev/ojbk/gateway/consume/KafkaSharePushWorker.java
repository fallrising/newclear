package dev.ojbk.gateway.consume;

import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import dev.ojbk.messaging.MessageLimits;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AlterConfigOp;
import org.apache.kafka.clients.admin.ConfigEntry;
import org.apache.kafka.clients.consumer.AcknowledgeType;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaShareConsumer;
import org.apache.kafka.clients.consumer.ShareConsumer;
import org.apache.kafka.common.KafkaException;
import org.apache.kafka.common.config.ConfigResource;
import org.apache.kafka.common.errors.WakeupException;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;

public final class KafkaSharePushWorker implements PushSubscriptionWorker {
    private static final Duration POLL_TIMEOUT = Duration.ofMillis(250);

    private final ShareConsumer<byte[], byte[]> consumer;
    private final SubscriptionConfig subscription;
    private final PushRecordHandler handler;
    private final ExecutorService deliveries = Executors.newVirtualThreadPerTaskExecutor();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private final AtomicLong acceptedCount = new AtomicLong();
    private volatile Thread pollThread;

    public KafkaSharePushWorker(
            String bootstrapServers,
            SubscriptionConfig subscription,
            PushRecordHandler handler) {
        this(
                consumer(
                        bootstrapServers,
                        subscription,
                        PushSubscriptionSpec.from(subscription.spec()).concurrency()),
                subscription,
                handler);
    }

    KafkaSharePushWorker(
            ShareConsumer<byte[], byte[]> consumer,
            SubscriptionConfig subscription,
            PushRecordHandler handler) {
        this.consumer = java.util.Objects.requireNonNull(consumer, "consumer");
        this.subscription = validate(subscription);
        this.handler = java.util.Objects.requireNonNull(handler, "handler");
    }

    @Override
    public void start() {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("push worker can only be started once");
        }
        running.set(true);
        pollThread = Thread.ofVirtual()
                .name("ojbquay-share-" + subscription.id())
                .start(this::poll);
    }

    @Override
    public boolean running() {
        return running.get();
    }

    @Override
    public Optional<String> lastError() {
        return Optional.ofNullable(lastError.get());
    }

    @Override
    public long acceptedCount() {
        return acceptedCount.get();
    }

    private void poll() {
        try {
            consumer.subscribe(List.of(
                    subscription.topic(),
                    subscription.topic() + "." + subscription.group() + ".retry"));
            while (running.get()) {
                try {
                    var records = consumer.poll(POLL_TIMEOUT);
                    if (!records.isEmpty()) {
                        process(records);
                    }
                } catch (WakeupException wakeup) {
                    if (running.get()) {
                        recordFailure(wakeup);
                    }
                } catch (RuntimeException failure) {
                    recordFailure(failure);
                }
            }
        } finally {
            running.set(false);
            consumer.close(Duration.ofSeconds(3));
        }
    }

    private void process(
            Iterable<ConsumerRecord<byte[], byte[]>> records) {
        List<Pending> pending = new ArrayList<>();
        for (ConsumerRecord<byte[], byte[]> record : records) {
            Future<AcknowledgeType> outcome =
                    deliveries.submit(() -> handle(record));
            pending.add(new Pending(record, outcome));
        }

        long accepted = 0;
        for (Pending item : pending) {
            AcknowledgeType acknowledgement = await(item.outcome());
            consumer.acknowledge(item.record(), acknowledgement);
            if (acknowledgement == AcknowledgeType.ACCEPT) {
                accepted++;
            }
        }
        var commits = consumer.commitSync(Duration.ofSeconds(10));
        Optional<KafkaException> failedCommit = commits.values().stream()
                .filter(Optional::isPresent)
                .map(Optional::get)
                .findFirst();
        if (failedCommit.isPresent()) {
            recordFailure(failedCommit.get());
            return;
        }
        acceptedCount.addAndGet(accepted);
    }

    private AcknowledgeType handle(ConsumerRecord<byte[], byte[]> record) {
        try {
            return handler.handle(PushMessage.from(record), subscription);
        } catch (RuntimeException invalidRecord) {
            return AcknowledgeType.REJECT;
        }
    }

    private static AcknowledgeType await(Future<AcknowledgeType> outcome) {
        try {
            return outcome.get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return AcknowledgeType.RELEASE;
        } catch (ExecutionException failed) {
            return AcknowledgeType.RELEASE;
        }
    }

    private void recordFailure(RuntimeException failure) {
        lastError.set(failure.getClass().getSimpleName());
    }

    @Override
    public void close() {
        running.set(false);
        if (!started.get()) {
            consumer.close(Duration.ofSeconds(3));
            deliveries.close();
            return;
        }
        consumer.wakeup();
        deliveries.shutdownNow();
        Thread active = pollThread;
        if (active != null) {
            try {
                active.join(Duration.ofSeconds(5));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static SubscriptionConfig validate(SubscriptionConfig subscription) {
        java.util.Objects.requireNonNull(subscription, "subscription");
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(subscription.spec());
        if (!subscription.enabled() || spec.ordered()) {
            throw new IllegalArgumentException(
                    "share worker requires an enabled unordered push subscription");
        }
        return subscription;
    }

    private static Properties properties(
            String bootstrapServers,
            SubscriptionConfig subscription,
            int concurrency) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, subscription.group());
        properties.put(
                ConsumerConfig.CLIENT_ID_CONFIG,
                "ojbquay-share-" + subscription.id());
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, concurrency);
        properties.put("share.acknowledgement.mode", "explicit");
        properties.put("share.acquire.mode", "record_limit");
        properties.put(
                ConsumerConfig.MAX_PARTITION_FETCH_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES);
        properties.put(
                ConsumerConfig.FETCH_MAX_BYTES_CONFIG,
                MessageLimits.MAX_DELAY_FETCH_BYTES * 2);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        properties.put(
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return properties;
    }

    private static ShareConsumer<byte[], byte[]> consumer(
            String bootstrapServers,
            SubscriptionConfig subscription,
            int concurrency) {
        Properties properties = properties(bootstrapServers, subscription, concurrency);
        configureStartOffset(properties, subscription.group());
        return new KafkaShareConsumer<>(properties);
    }

    private static void configureStartOffset(Properties properties, String group) {
        ConfigResource resource =
                new ConfigResource(ConfigResource.Type.GROUP, group);
        AlterConfigOp earliest = new AlterConfigOp(
                new ConfigEntry("share.auto.offset.reset", "earliest"),
                AlterConfigOp.OpType.SET);
        try (Admin admin = Admin.create(properties)) {
            admin.incrementalAlterConfigs(
                            java.util.Map.of(resource, List.of(earliest)))
                    .all()
                    .get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "share group initialization was interrupted", interrupted);
        } catch (ExecutionException failure) {
            throw new IllegalStateException(
                    "share group initialization failed", failure.getCause());
        }
    }

    private record Pending(
            ConsumerRecord<byte[], byte[]> record,
            Future<AcknowledgeType> outcome) {}
}
