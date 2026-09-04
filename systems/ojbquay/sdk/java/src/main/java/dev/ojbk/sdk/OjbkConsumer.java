package dev.ojbk.sdk;

import ojbk.v1.AckRequest;
import ojbk.v1.AckResponse;
import ojbk.v1.Code;
import ojbk.v1.ConsumerServiceGrpc;
import ojbk.v1.MessageOut;
import ojbk.v1.PollRequest;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.StatusRuntimeException;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.LockSupport;

public final class OjbkConsumer implements AutoCloseable {
    private static final Metadata.Key<String> TOKEN_HEADER =
            Metadata.Key.of(
                    "x-ojbk-token", Metadata.ASCII_STRING_MARSHALLER);
    private static final Duration MAX_RECONNECT_DELAY =
            Duration.ofSeconds(5);

    private final ManagedChannel channel;
    private final ConsumerServiceGrpc.ConsumerServiceBlockingStub blocking;
    private final String group;
    private final String topic;
    private final int maxBatch;
    private final Duration linger;
    private final Duration deadline;
    private final Duration reconnectDelay;
    private final boolean ownsChannel;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean subscribed = new AtomicBoolean();

    OjbkConsumer(
            ManagedChannel channel,
            String token,
            String group,
            String topic,
            int maxBatch,
            Duration linger,
            Duration deadline,
            Duration reconnectDelay,
            boolean ownsChannel) {
        this.channel = Objects.requireNonNull(channel, "channel");
        requireText(token, "token");
        this.group = requireText(group, "group");
        this.topic = requireText(topic, "topic");
        if (maxBatch < 1 || maxBatch > 500) {
            throw new IllegalArgumentException("maxBatch must be 1..500");
        }
        this.maxBatch = maxBatch;
        if (linger == null
                || linger.isNegative()
                || linger.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException(
                    "linger must be 0..30 seconds");
        }
        this.linger = linger;
        if (deadline == null || deadline.isZero() || deadline.isNegative()) {
            throw new IllegalArgumentException("deadline must be positive");
        }
        this.deadline = deadline;
        if (reconnectDelay == null
                || reconnectDelay.isZero()
                || reconnectDelay.isNegative()
                || reconnectDelay.compareTo(MAX_RECONNECT_DELAY) > 0) {
            throw new IllegalArgumentException(
                    "reconnectDelay must be positive and at most 5 seconds");
        }
        this.reconnectDelay = reconnectDelay;
        this.ownsChannel = ownsChannel;

        Metadata metadata = new Metadata();
        metadata.put(TOKEN_HEADER, token);
        blocking = ConsumerServiceGrpc.newBlockingStub(channel)
                .withInterceptors(
                        MetadataUtils.newAttachHeadersInterceptor(metadata));
    }

    public static Builder forTarget(
            String target, String group, String topic, String token) {
        return new Builder(target, group, topic, token);
    }

    public List<OjbkDelivery> poll() {
        try {
            return pollTransport();
        } catch (StatusRuntimeException transport) {
            throw new OjbkException(
                    Code.INTERNAL, "consumer transport failed", transport);
        }
    }

    public void acknowledge(
            List<OjbkDelivery> accepted, List<OjbkDelivery> released) {
        List<String> ack = accepted.stream()
                .map(OjbkDelivery::ackToken)
                .toList();
        List<String> nack = released.stream()
                .map(OjbkDelivery::ackToken)
                .toList();
        try {
            acknowledgeTransport(ack, nack);
        } catch (StatusRuntimeException transport) {
            throw new OjbkException(
                    Code.INTERNAL, "consumer acknowledgement transport failed", transport);
        }
    }

    public ConsumerSubscription subscribe(DeliveryHandler handler) {
        Objects.requireNonNull(handler, "handler");
        if (closed.get()) {
            throw new IllegalStateException("consumer is closed");
        }
        if (!subscribed.compareAndSet(false, true)) {
            throw new IllegalStateException(
                    "consumer already has an active subscription");
        }
        ConsumerSubscription subscription = new ConsumerSubscription();
        Thread thread = Thread.ofVirtual()
                .name("ojbk-consumer-" + group + "-" + topic)
                .start(() -> run(handler, subscription));
        subscription.attach(thread);
        return subscription;
    }

    private void run(
            DeliveryHandler handler, ConsumerSubscription subscription) {
        long delayNanos = reconnectDelay.toNanos();
        try {
            while (!closed.get() && subscription.runningFlag()) {
                try {
                    List<OjbkDelivery> deliveries = pollTransport();
                    List<String> accepted = new ArrayList<>(deliveries.size());
                    List<String> released = new ArrayList<>(deliveries.size());
                    for (OjbkDelivery delivery : deliveries) {
                        DeliveryResult result;
                        try {
                            result = Objects.requireNonNull(
                                    handler.handle(delivery),
                                    "handler result");
                        } catch (Exception failure) {
                            result = DeliveryResult.NACK;
                        }
                        (result == DeliveryResult.ACK ? accepted : released)
                                .add(delivery.ackToken());
                    }
                    if (!accepted.isEmpty() || !released.isEmpty()) {
                        acknowledgeTransport(accepted, released);
                    }
                    delayNanos = reconnectDelay.toNanos();
                } catch (StatusRuntimeException transport) {
                    if (!pause(subscription, delayNanos)) {
                        break;
                    }
                    delayNanos = Math.min(
                            MAX_RECONNECT_DELAY.toNanos(),
                            delayNanos > Long.MAX_VALUE / 2
                                    ? Long.MAX_VALUE
                                    : delayNanos * 2);
                } catch (OjbkException businessFailure) {
                    subscription.failed(businessFailure);
                    break;
                }
            }
        } finally {
            subscribed.set(false);
            subscription.finished();
        }
    }

    private List<OjbkDelivery> pollTransport() {
        ensureOpen();
        Iterator<MessageOut> stream = blocking
                .withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                .poll(PollRequest.newBuilder()
                        .setGroup(group)
                        .setTopic(topic)
                        .setMaxBatch(maxBatch)
                        .setLingerMs((int) linger.toMillis())
                        .build());
        List<OjbkDelivery> deliveries = new ArrayList<>(maxBatch);
        while (stream.hasNext()) {
            MessageOut message = stream.next();
            if (message.getCode() != Code.OK) {
                throw new OjbkException(message.getCode(), message.getMsg());
            }
            if (message.getAckToken().isBlank()) {
                throw new OjbkException(
                        Code.INTERNAL,
                        "gateway response is missing acknowledgement token");
            }
            deliveries.add(new OjbkDelivery(
                    message.getTopic(),
                    message.getPartition(),
                    message.getOffset(),
                    message.getKey().isBlank() ? null : message.getKey(),
                    message.getValue().toByteArray(),
                    message.getTagsList(),
                    message.getHeadersMap(),
                    message.getAckToken(),
                    message.getDeliveryCount()));
        }
        return List.copyOf(deliveries);
    }

    private void acknowledgeTransport(
            List<String> accepted, List<String> released) {
        ensureOpen();
        AckResponse response = blocking
                .withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                .ack(AckRequest.newBuilder()
                        .setGroup(group)
                        .addAllAck(accepted)
                        .addAllNack(released)
                        .build());
        if (response.getCode() != Code.OK) {
            throw new OjbkException(response.getCode(), response.getMsg());
        }
    }

    private boolean pause(
            ConsumerSubscription subscription, long delayNanos) {
        if (closed.get() || !subscription.runningFlag()) {
            return false;
        }
        LockSupport.parkNanos(delayNanos);
        return !Thread.interrupted()
                && !closed.get()
                && subscription.runningFlag();
    }

    private void ensureOpen() {
        if (closed.get()) {
            throw new IllegalStateException("consumer is closed");
        }
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        if (ownsChannel) {
            channel.shutdown();
            try {
                if (!channel.awaitTermination(5, TimeUnit.SECONDS)) {
                    channel.shutdownNow();
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                channel.shutdownNow();
            }
        }
    }

    public static final class Builder {
        private final String target;
        private final String group;
        private final String topic;
        private final String token;
        private int maxBatch = 64;
        private Duration linger = Duration.ofSeconds(1);
        private Duration deadline = Duration.ofSeconds(35);
        private Duration reconnectDelay = Duration.ofMillis(100);
        private boolean plaintext;

        private Builder(
                String target, String group, String topic, String token) {
            this.target = requireText(target, "target");
            this.group = group;
            this.topic = topic;
            this.token = token;
        }

        public Builder maxBatch(int value) {
            maxBatch = value;
            return this;
        }

        public Builder linger(Duration value) {
            linger = value;
            return this;
        }

        public Builder deadline(Duration value) {
            deadline = value;
            return this;
        }

        public Builder reconnectDelay(Duration value) {
            reconnectDelay = value;
            return this;
        }

        public Builder plaintext() {
            plaintext = true;
            return this;
        }

        public OjbkConsumer build() {
            NettyChannelBuilder channel = NettyChannelBuilder.forTarget(target);
            if (plaintext) {
                channel.usePlaintext();
            }
            return new OjbkConsumer(
                    channel.build(),
                    token,
                    group,
                    topic,
                    maxBatch,
                    linger,
                    deadline,
                    reconnectDelay,
                    true);
        }
    }
}
