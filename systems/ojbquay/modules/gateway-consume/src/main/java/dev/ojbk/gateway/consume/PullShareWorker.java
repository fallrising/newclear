package dev.ojbk.gateway.consume;

import dev.ojbk.config.PullSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.kafka.common.errors.WakeupException;

public final class PullShareWorker implements PullWorker {
    private static final Duration BROKER_POLL = Duration.ofMillis(100);

    private final PullBroker broker;
    private final SubscriptionConfig subscription;
    private final PullSubscriptionSpec spec;
    private final PushPipeline pipeline;
    private final PullDlqPublisher dlq;
    private final Clock clock;
    private final ConsumeMetrics metrics;
    private final LinkedBlockingDeque<PullDelivery> available;
    private final ConcurrentLinkedQueue<AckCommand> commands =
            new ConcurrentLinkedQueue<>();
    private final Map<PullRecordId, ActiveDelivery> byRecord = new HashMap<>();
    private final Map<String, ActiveDelivery> byToken = new HashMap<>();
    private final Map<PullRecordId, PullDisposition> automatic = new HashMap<>();
    private final List<AckCommand> pending = new ArrayList<>();
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private final AtomicInteger inflight = new AtomicInteger();
    private final AtomicLong accepted = new AtomicLong();
    private volatile Thread pollThread;
    private List<PullBrokerRecord> previous = List.of();

    PullShareWorker(
            PullBroker broker,
            SubscriptionConfig subscription,
            PushPipeline pipeline,
            PullDlqPublisher dlq,
            Clock clock) {
        this(broker, subscription, pipeline, dlq, clock, null);
    }

    PullShareWorker(
            PullBroker broker,
            SubscriptionConfig subscription,
            PushPipeline pipeline,
            PullDlqPublisher dlq,
            Clock clock,
            ConsumeMetrics metrics) {
        this.broker = java.util.Objects.requireNonNull(broker, "broker");
        this.subscription = validate(subscription);
        this.spec = PullSubscriptionSpec.from(subscription.spec());
        this.pipeline = java.util.Objects.requireNonNull(pipeline, "pipeline");
        this.dlq = java.util.Objects.requireNonNull(dlq, "dlq");
        this.clock = java.util.Objects.requireNonNull(clock, "clock");
        this.metrics = metrics;
        this.available = new LinkedBlockingDeque<>(spec.maxInflight());
        pipeline.validate(spec);
    }

    @Override
    public void start() {
        if (!started.compareAndSet(false, true)) {
            throw new IllegalStateException("pull worker can only be started once");
        }
        running.set(true);
        pollThread = Thread.ofVirtual()
                .name("ojbquay-pull-" + subscription.id())
                .start(this::run);
    }

    public List<PullDelivery> pollBatch(int maximum, Duration linger)
            throws InterruptedException {
        if (maximum < 1 || maximum > spec.maxBatch()) {
            throw new IllegalArgumentException(
                    "pull batch must be 1.." + spec.maxBatch());
        }
        if (linger == null
                || linger.isNegative()
                || linger.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException(
                    "pull linger must be 0..30000 milliseconds");
        }
        if (!running.get()) {
            throw new IllegalStateException("pull worker is not running");
        }

        PullDelivery first = available.poll(
                linger.toNanos(), TimeUnit.NANOSECONDS);
        if (first == null) {
            return List.of();
        }
        List<PullDelivery> result = new ArrayList<>(maximum);
        result.add(first);
        available.drainTo(result, maximum - 1);
        return List.copyOf(result);
    }

    public PullAckResult acknowledge(
            List<String> accepted, List<String> released, Duration timeout) {
        List<String> ack = List.copyOf(
                java.util.Objects.requireNonNull(accepted, "accepted"));
        List<String> nack = List.copyOf(
                java.util.Objects.requireNonNull(released, "released"));
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException(
                    "acknowledgement timeout must be positive");
        }
        if (ack.isEmpty() && nack.isEmpty()) {
            return PullAckResult.invalid("ack or nack token is required");
        }
        if (ack.size() + nack.size() > PullSubscriptionSpec.MAX_INFLIGHT) {
            return PullAckResult.invalid("acknowledgement batch exceeds 500 tokens");
        }
        Set<String> distinct = new HashSet<>(ack);
        distinct.addAll(nack);
        if (distinct.size() != ack.size() + nack.size()
                || distinct.stream().anyMatch(String::isBlank)) {
            return PullAckResult.invalid(
                    "acknowledgement tokens must be non-blank and unique");
        }
        if (!running.get()) {
            return PullAckResult.unavailable();
        }

        AckCommand command = new AckCommand(ack, nack);
        commands.add(command);
        try {
            return command.result().get(timeout.toNanos(), TimeUnit.NANOSECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return PullAckResult.unavailable();
        } catch (java.util.concurrent.ExecutionException | TimeoutException failure) {
            return PullAckResult.unavailable();
        }
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
        return accepted.get();
    }

    @Override
    public long subscriptionId() {
        return subscription.id();
    }

    @Override
    public String group() {
        return subscription.group();
    }

    @Override
    public String topic() {
        return subscription.topic();
    }

    public int inflightCount() {
        return inflight.get();
    }

    private void run() {
        try {
            while (running.get()) {
                processCommands();
                settlePrevious();
                if (!running.get()) {
                    break;
                }
                List<PullBrokerRecord> records;
                try {
                    records = broker.poll(BROKER_POLL);
                } catch (WakeupException wakeup) {
                    continue;
                }
                previous = List.copyOf(records);
                records.forEach(this::acquired);
            }
        } catch (RuntimeException failure) {
            lastError.set(failure.getClass().getSimpleName()
                    + ":"
                    + String.valueOf(failure.getMessage()));
            commands.forEach(command ->
                    command.result().complete(PullAckResult.unavailable()));
            pending.forEach(command ->
                    command.result().complete(PullAckResult.unavailable()));
        } finally {
            running.set(false);
            broker.close();
        }
    }

    private void processCommands() {
        AckCommand command;
        while ((command = commands.poll()) != null) {
            Map<String, PullDisposition> requested = new LinkedHashMap<>();
            command.accepted().forEach(
                    token -> requested.put(token, PullDisposition.ACCEPT));
            command.released().forEach(
                    token -> requested.put(token, PullDisposition.RELEASE));
            boolean valid = requested.keySet().stream().allMatch(token -> {
                ActiveDelivery delivery = byToken.get(token);
                return delivery != null && delivery.decision() == null;
            });
            if (!valid) {
                command.result().complete(
                        PullAckResult.invalid("acknowledgement token is stale or unknown"));
                continue;
            }
            requested.forEach(
                    (token, disposition) -> byToken.get(token).decide(disposition));
            pending.add(command);
        }
    }

    private void settlePrevious() {
        if (previous.isEmpty()) {
            return;
        }
        Instant now = clock.instant();
        Map<PullRecordId, PullDisposition> dispositions = new LinkedHashMap<>();
        previous.forEach(record -> dispositions.put(
                record.id(), disposition(record, now)));
        broker.settle(dispositions);
        dispositions.forEach((id, disposition) -> {
            if (disposition != PullDisposition.RENEW) {
                if (disposition == PullDisposition.ACCEPT) {
                    accepted.incrementAndGet();
                }
                remove(id);
                automatic.remove(id);
            }
        });
        completeCommands();
        previous = List.of();
    }

    private PullDisposition disposition(PullBrokerRecord record, Instant now) {
        PullDisposition fixed = automatic.get(record.id());
        if (fixed != null) {
            return fixed;
        }
        ActiveDelivery active = byRecord.get(record.id());
        if (active == null) {
            return PullDisposition.RELEASE;
        }
        if (!now.isBefore(active.expiresAt())) {
            return PullDisposition.RELEASE;
        }
        PullDisposition decision = active.decision();
        if (decision != PullDisposition.RELEASE
                || record.message().deliveryCount() <= spec.maxRetry()) {
            return decision == null ? PullDisposition.RENEW : decision;
        }
        if (!spec.dlqEnabled()) {
            return PullDisposition.RELEASE;
        }
        try {
            dlq.publish(
                    record.message(),
                    record.message().originTopic()
                            + "."
                            + subscription.group()
                            + ".dlq",
                    "PULL_RETRY_EXHAUSTED");
            if (metrics != null) {
                metrics.recordDlq(subscription.id());
            }
            return PullDisposition.ACCEPT;
        } catch (RuntimeException unavailable) {
            return PullDisposition.RELEASE;
        }
    }

    private void acquired(PullBrokerRecord record) {
        ActiveDelivery existing = byRecord.get(record.id());
        if (existing != null || automatic.containsKey(record.id())) {
            return;
        }
        PipelineResult result = pipeline.apply(record.message(), spec);
        if (result.action() == PipelineAction.FILTERED) {
            automatic.put(record.id(), PullDisposition.ACCEPT);
            return;
        }
        if (result.action() == PipelineAction.ERROR) {
            automatic.put(record.id(), pipelineError(record.message()));
            return;
        }
        if (byToken.size() >= spec.maxInflight()) {
            automatic.put(record.id(), PullDisposition.RELEASE);
            return;
        }

        String token = PullAckToken.issue(subscription.id(), record.id());
        PushMessage message = result.message();
        PullDelivery delivery = new PullDelivery(
                message.topic(),
                message.partition(),
                message.offset(),
                message.timestamp(),
                message.key(),
                result.body(),
                message.tags(),
                message.headers(),
                token,
                message.deliveryCount());
        ActiveDelivery active = new ActiveDelivery(
                token,
                clock.instant().plusMillis(spec.ackTimeoutMs()));
        byRecord.put(record.id(), active);
        byToken.put(token, active);
        if (!available.offer(delivery)) {
            byRecord.remove(record.id());
            byToken.remove(token);
            automatic.put(record.id(), PullDisposition.RELEASE);
        }
        updateInflight();
    }

    private PullDisposition pipelineError(PushMessage message) {
        if (!spec.dlqEnabled()) {
            return PullDisposition.REJECT;
        }
        try {
            dlq.publish(
                    message,
                    message.originTopic() + "." + subscription.group() + ".dlq",
                    "PIPELINE_ERROR");
            if (metrics != null) {
                metrics.recordDlq(subscription.id());
            }
            return PullDisposition.ACCEPT;
        } catch (RuntimeException unavailable) {
            return PullDisposition.RELEASE;
        }
    }

    private void remove(PullRecordId id) {
        ActiveDelivery removed = byRecord.remove(id);
        if (removed != null) {
            byToken.remove(removed.token());
            available.removeIf(
                    delivery -> delivery.ackToken().equals(removed.token()));
            updateInflight();
        }
    }

    private void completeCommands() {
        pending.removeIf(command -> {
            boolean completed = java.util.stream.Stream.concat(
                            command.accepted().stream(), command.released().stream())
                    .noneMatch(byToken::containsKey);
            if (completed) {
                command.result().complete(PullAckResult.ok());
            }
            return completed;
        });
    }

    private void updateInflight() {
        int value = byToken.size();
        inflight.set(value);
        if (metrics != null) {
            metrics.setPullInflight(Long.toString(subscription.id()), value);
        }
    }

    private static SubscriptionConfig validate(SubscriptionConfig subscription) {
        java.util.Objects.requireNonNull(subscription, "subscription");
        if (!subscription.enabled()
                || !"PULL".equals(subscription.spec().get("mode"))) {
            throw new IllegalArgumentException(
                    "pull worker requires an enabled pull subscription");
        }
        return subscription;
    }

    @Override
    public void close() {
        if (!started.get()) {
            broker.close();
            return;
        }
        running.set(false);
        broker.wakeup();
        Thread active = pollThread;
        if (active != null) {
            try {
                active.join(Duration.ofSeconds(5));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static final class ActiveDelivery {
        private final String token;
        private final Instant expiresAt;
        private PullDisposition decision;

        private ActiveDelivery(String token, Instant expiresAt) {
            this.token = token;
            this.expiresAt = expiresAt;
        }

        private String token() {
            return token;
        }

        private Instant expiresAt() {
            return expiresAt;
        }

        private PullDisposition decision() {
            return decision;
        }

        private void decide(PullDisposition value) {
            decision = value;
        }
    }

    private record AckCommand(
            List<String> accepted,
            List<String> released,
            CompletableFuture<PullAckResult> result) {
        private AckCommand(List<String> accepted, List<String> released) {
            this(accepted, released, new CompletableFuture<>());
        }
    }
}
