package dev.ojbk.gateway.consume;

import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import dev.ojbk.messaging.MessageLimits;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.CloseOptions;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.WakeupException;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;

public final class KafkaOrderedPushWorker implements PushSubscriptionWorker {
    private static final Duration POLL_TIMEOUT = Duration.ofMillis(250);

    private final KafkaConsumer<byte[], byte[]> consumer;
    private final SubscriptionConfig subscription;
    private final PushSubscriptionSpec spec;
    private final OrderedPushRecordHandler handler;
    private final OrderKeyExtractor keyExtractor = new OrderKeyExtractor();
    private final BoundedStripedExecutor stripes;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private final AtomicLong acceptedCount = new AtomicLong();
    private volatile Thread pollThread;

    public KafkaOrderedPushWorker(
            String bootstrapServers,
            SubscriptionConfig subscription,
            OrderedPushRecordHandler handler) {
        this.subscription = validate(subscription);
        this.spec = PushSubscriptionSpec.from(subscription.spec());
        this.handler = java.util.Objects.requireNonNull(handler, "handler");
        int maxInFlight = Math.min(500, Math.max(spec.concurrency(), spec.concurrency() * 4));
        this.stripes = new BoundedStripedExecutor(spec.concurrency(), maxInFlight);
        this.consumer =
                new KafkaConsumer<>(properties(bootstrapServers, subscription, maxInFlight));
    }

    @Override
    public void start() {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("push worker can only be started once");
        }
        running.set(true);
        pollThread = Thread.ofVirtual()
                .name("ojbquay-ordered-" + subscription.id())
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
            consumer.close(CloseOptions.timeout(Duration.ofSeconds(3)));
        }
    }

    private void process(Iterable<ConsumerRecord<byte[], byte[]>> records) {
        List<Future<Boolean>> outcomes = new ArrayList<>();
        Map<TopicPartition, Long> firstOffsets = new HashMap<>();
        int count = 0;
        try {
            for (ConsumerRecord<byte[], byte[]> record : records) {
                count++;
                TopicPartition partition =
                        new TopicPartition(record.topic(), record.partition());
                firstOffsets.merge(partition, record.offset(), Math::min);
                PushMessage message = PushMessage.from(record);
                String orderKey;
                boolean valid = true;
                try {
                    orderKey = keyExtractor.extract(message, spec);
                } catch (RuntimeException invalidKey) {
                    orderKey = "__invalid__:" + record.topic() + ":" + record.partition();
                    valid = false;
                }
                boolean keyIsValid = valid;
                outcomes.add(stripes.submit(
                        orderKey,
                        () -> keyIsValid
                                ? handler.handle(message, subscription)
                                : handler.invalidOrderKey(message, subscription)));
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            seek(firstOffsets);
            return;
        }

        boolean terminal = true;
        for (Future<Boolean> outcome : outcomes) {
            terminal &= await(outcome);
        }
        if (!terminal) {
            seek(firstOffsets);
            return;
        }
        consumer.commitSync(Duration.ofSeconds(10));
        acceptedCount.addAndGet(count);
    }

    private static boolean await(Future<Boolean> outcome) {
        try {
            return outcome.get();
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        } catch (ExecutionException failed) {
            return false;
        }
    }

    private void seek(Map<TopicPartition, Long> offsets) {
        offsets.forEach(consumer::seek);
    }

    private void recordFailure(RuntimeException failure) {
        lastError.set(failure.getClass().getSimpleName());
    }

    @Override
    public void close() {
        running.set(false);
        stripes.close();
        if (!started.get()) {
            consumer.close(CloseOptions.timeout(Duration.ofSeconds(3)));
            return;
        }
        consumer.wakeup();
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
        if (!subscription.enabled() || !spec.ordered()) {
            throw new IllegalArgumentException(
                    "ordered worker requires an enabled ordered push subscription");
        }
        return subscription;
    }

    private static Properties properties(
            String bootstrapServers,
            SubscriptionConfig subscription,
            int maxInFlight) {
        if (bootstrapServers == null || bootstrapServers.isBlank()) {
            throw new IllegalArgumentException("bootstrapServers must not be blank");
        }
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers);
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, subscription.group());
        properties.put(
                ConsumerConfig.CLIENT_ID_CONFIG,
                "ojbquay-ordered-" + subscription.id());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.ISOLATION_LEVEL_CONFIG, "read_committed");
        properties.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, maxInFlight);
        properties.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, Integer.MAX_VALUE);
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
}
