package dev.ojbk.sdk;

import com.google.protobuf.ByteString;
import ojbk.v1.Code;
import ojbk.v1.CancelDelayRequest;
import ojbk.v1.DelayRequest;
import ojbk.v1.DelayResponse;
import ojbk.v1.MessageIn;
import ojbk.v1.ProduceRequest;
import ojbk.v1.ProduceResponse;
import ojbk.v1.ProducerServiceGrpc;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.netty.shaded.io.grpc.netty.NettyChannelBuilder;
import io.grpc.stub.MetadataUtils;
import io.grpc.stub.StreamObserver;
import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

public final class OjbkProducer implements AutoCloseable {
    private static final Metadata.Key<String> TOKEN_HEADER =
            Metadata.Key.of("x-ojbk-token", Metadata.ASCII_STRING_MARSHALLER);

    private final ManagedChannel channel;
    private final ProducerServiceGrpc.ProducerServiceBlockingStub blocking;
    private final ProducerServiceGrpc.ProducerServiceStub async;
    private final Duration deadline;
    private final boolean ownsChannel;

    OjbkProducer(
            ManagedChannel channel, String token, Duration deadline, boolean ownsChannel) {
        this.channel = Objects.requireNonNull(channel, "channel");
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
        if (deadline == null || deadline.isZero() || deadline.isNegative()) {
            throw new IllegalArgumentException("deadline must be positive");
        }
        Metadata metadata = new Metadata();
        metadata.put(TOKEN_HEADER, token);
        var interceptor = MetadataUtils.newAttachHeadersInterceptor(metadata);
        this.blocking = ProducerServiceGrpc.newBlockingStub(channel).withInterceptors(interceptor);
        this.async = ProducerServiceGrpc.newStub(channel).withInterceptors(interceptor);
        this.deadline = deadline;
        this.ownsChannel = ownsChannel;
    }

    public static Builder forTarget(String target, String token) {
        return new Builder(target, token);
    }

    public ProduceAcknowledgement send(OjbkMessage message) {
        try {
            ProduceResponse response = blocking
                    .withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                    .produce(request(message));
            return acknowledgement(response);
        } catch (io.grpc.StatusRuntimeException transport) {
            throw new OjbkException(Code.INTERNAL, "producer transport failed", transport);
        }
    }

    public CompletableFuture<ProduceAcknowledgement> sendAsync(OjbkMessage message) {
        CompletableFuture<ProduceAcknowledgement> future = new CompletableFuture<>();
        async.withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                .produce(request(message), new StreamObserver<>() {
                    @Override
                    public void onNext(ProduceResponse response) {
                        try {
                            future.complete(acknowledgement(response));
                        } catch (RuntimeException failure) {
                            future.completeExceptionally(failure);
                        }
                    }

                    @Override
                    public void onError(Throwable failure) {
                        future.completeExceptionally(
                                new OjbkException(Code.INTERNAL, "producer transport failed", failure));
                    }

                    @Override
                    public void onCompleted() {}
                });
        return future;
    }

    public String schedule(OjbkMessage message, DelaySchedule schedule) {
        Objects.requireNonNull(message, "message");
        Objects.requireNonNull(schedule, "schedule");
        DelayRequest.Builder request = DelayRequest.newBuilder()
                .setMsg(message(message))
                .setDelayId(schedule.delayId())
                .setDueAtMs(schedule.dueAt().toEpochMilli());
        if (schedule.loopInterval() != null) {
            request.setLoopIntervalMs(schedule.loopInterval().toMillis());
            request.setLoopTimes(schedule.loopTimes());
        }
        if (schedule.expireAt() != null) {
            request.setExpireAtMs(schedule.expireAt().toEpochMilli());
        }
        try {
            DelayResponse response = blocking
                    .withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                    .produceDelay(request.build());
            return delayId(response);
        } catch (io.grpc.StatusRuntimeException transport) {
            throw new OjbkException(Code.INTERNAL, "delay transport failed", transport);
        }
    }

    public String cancelDelay(String topic, String delayId) {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (delayId == null || delayId.isBlank()) {
            throw new IllegalArgumentException("delayId must not be blank");
        }
        try {
            DelayResponse response = blocking
                    .withDeadlineAfter(deadline.toNanos(), TimeUnit.NANOSECONDS)
                    .cancelDelay(CancelDelayRequest.newBuilder()
                            .setTopic(topic)
                            .setDelayId(delayId)
                            .build());
            return delayId(response);
        } catch (io.grpc.StatusRuntimeException transport) {
            throw new OjbkException(Code.INTERNAL, "delay transport failed", transport);
        }
    }

    private static ProduceRequest request(OjbkMessage message) {
        Objects.requireNonNull(message, "message");
        return ProduceRequest.newBuilder().setMsg(message(message)).build();
    }

    private static MessageIn message(OjbkMessage message) {
        MessageIn.Builder input = MessageIn.newBuilder()
                .setTopic(message.topic())
                .setValue(ByteString.copyFrom(message.value()))
                .addAllTags(message.tags())
                .putAllHeaders(message.headers());
        if (message.key() != null) {
            input.setKey(message.key());
        }
        if (message.partition() != null) {
            input.setPartition(message.partition());
        }
        return input.build();
    }

    private static ProduceAcknowledgement acknowledgement(ProduceResponse response) {
        if (response.getCode() != Code.OK) {
            throw new OjbkException(response.getCode(), response.getMsg());
        }
        if (!response.hasAck()) {
            throw new OjbkException(Code.INTERNAL, "gateway response is missing acknowledgement");
        }
        return new ProduceAcknowledgement(
                response.getAck().getTopic(),
                response.getAck().getPartition(),
                response.getAck().getOffset());
    }

    private static String delayId(DelayResponse response) {
        if (response.getCode() != Code.OK) {
            throw new OjbkException(response.getCode(), response.getMsg());
        }
        if (response.getDelayId().isBlank()) {
            throw new OjbkException(Code.INTERNAL, "gateway response is missing delay ID");
        }
        return response.getDelayId();
    }

    @Override
    public void close() {
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
        private final String token;
        private Duration deadline = Duration.ofSeconds(5);
        private boolean plaintext;

        private Builder(String target, String token) {
            if (target == null || target.isBlank()) {
                throw new IllegalArgumentException("target must not be blank");
            }
            this.target = target;
            this.token = token;
        }

        public Builder deadline(Duration value) {
            this.deadline = value;
            return this;
        }

        public Builder plaintext() {
            this.plaintext = true;
            return this;
        }

        public OjbkProducer build() {
            NettyChannelBuilder builder = NettyChannelBuilder.forTarget(target);
            if (plaintext) {
                builder.usePlaintext();
            }
            return new OjbkProducer(builder.build(), token, deadline, true);
        }
    }
}
