package dev.ojbk.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.google.protobuf.ByteString;
import ojbk.v1.AckRequest;
import ojbk.v1.AckResponse;
import ojbk.v1.Code;
import ojbk.v1.ConsumerServiceGrpc;
import ojbk.v1.MessageOut;
import ojbk.v1.PollRequest;
import io.grpc.Contexts;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class OjbkConsumerTest {
    private final FakeConsumerService service = new FakeConsumerService();
    private final AtomicReference<String> observedToken = new AtomicReference<>();
    private Server server;
    private ManagedChannel channel;
    private OjbkConsumer consumer;

    @BeforeEach
    void startServer() throws Exception {
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(io.grpc.ServerInterceptors.intercept(
                        service, tokenInterceptor(observedToken)))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        consumer = new OjbkConsumer(
                channel,
                "group-token",
                "settlement",
                "orders",
                16,
                Duration.ofMillis(50),
                Duration.ofSeconds(2),
                Duration.ofMillis(1),
                false);
    }

    @AfterEach
    void stopServer() throws Exception {
        consumer.close();
        channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    void subscribesHandlerAndBatchesAckAndNackWithMetadataAuth()
            throws Exception {
        service.mode.set(Mode.DELIVER);
        AtomicInteger observedDeliveryCount = new AtomicInteger();
        ConsumerSubscription subscription = consumer.subscribe(delivery -> {
            observedDeliveryCount.set(
                    Math.max(observedDeliveryCount.get(), delivery.deliveryCount()));
            return delivery.offset() == 1
                    ? DeliveryResult.ACK
                    : DeliveryResult.NACK;
        });
        try {
            assertThat(service.acked.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(subscription.lastError()).isEmpty();
        } finally {
            subscription.close();
        }

        assertThat(service.lastAck.get().getAckList()).containsExactly("ack-1");
        assertThat(service.lastAck.get().getNackList()).containsExactly("ack-2");
        assertThat(observedToken).hasValue("group-token");
        assertThat(observedDeliveryCount).hasValue(3);
    }

    @Test
    void reconnectsAfterTransportFailureWithoutSkippingTheDelivery()
            throws Exception {
        service.mode.set(Mode.FAIL_ONCE);
        ConsumerSubscription subscription =
                consumer.subscribe(delivery -> DeliveryResult.ACK);
        try {
            assertThat(service.acked.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(subscription.lastError()).isEmpty();
        } finally {
            subscription.close();
        }

        assertThat(service.polls.get()).isGreaterThanOrEqualTo(2);
        assertThat(service.lastAck.get().getAckList()).containsExactly("ack-1");
    }

    @Test
    void raisesTypedPollBusinessFailure() {
        service.mode.set(Mode.AUTH_FAILURE);

        assertThatThrownBy(consumer::poll)
                .isInstanceOf(OjbkException.class)
                .extracting(failure -> ((OjbkException) failure).code())
                .isEqualTo(Code.AUTH_FAILED);
    }

    private static ServerInterceptor tokenInterceptor(
            AtomicReference<String> observedToken) {
        Metadata.Key<String> token =
                Metadata.Key.of("x-ojbk-token", Metadata.ASCII_STRING_MARSHALLER);
        return new ServerInterceptor() {
            @Override
            public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                    ServerCall<ReqT, RespT> call,
                    Metadata headers,
                    ServerCallHandler<ReqT, RespT> next) {
                observedToken.set(headers.get(token));
                return Contexts.interceptCall(
                        io.grpc.Context.current(), call, headers, next);
            }
        };
    }

    private enum Mode {
        DELIVER,
        FAIL_ONCE,
        AUTH_FAILURE
    }

    private static final class FakeConsumerService
            extends ConsumerServiceGrpc.ConsumerServiceImplBase {
        private final AtomicReference<Mode> mode =
                new AtomicReference<>(Mode.DELIVER);
        private final AtomicInteger polls = new AtomicInteger();
        private final AtomicReference<AckRequest> lastAck = new AtomicReference<>();
        private final CountDownLatch acked = new CountDownLatch(1);

        @Override
        public void poll(
                PollRequest request, StreamObserver<MessageOut> responseObserver) {
            int attempt = polls.incrementAndGet();
            if (mode.get() == Mode.FAIL_ONCE && attempt == 1) {
                responseObserver.onError(
                        Status.UNAVAILABLE.asRuntimeException());
                return;
            }
            if (mode.get() == Mode.AUTH_FAILURE) {
                responseObserver.onNext(MessageOut.newBuilder()
                        .setCode(Code.AUTH_FAILED)
                        .setMsg("bad token")
                        .build());
                responseObserver.onCompleted();
                return;
            }
            if (lastAck.get() == null) {
                responseObserver.onNext(message(1, "ack-1", 3));
                if (mode.get() == Mode.DELIVER) {
                    responseObserver.onNext(message(2, "ack-2", 1));
                }
            }
            responseObserver.onCompleted();
        }

        @Override
        public void ack(
                AckRequest request,
                StreamObserver<AckResponse> responseObserver) {
            lastAck.set(request);
            responseObserver.onNext(
                    AckResponse.newBuilder().setCode(Code.OK).build());
            responseObserver.onCompleted();
            acked.countDown();
        }

        private static MessageOut message(
                long offset, String token, int deliveryCount) {
            return MessageOut.newBuilder()
                    .setTopic("orders")
                    .setPartition(0)
                    .setOffset(offset)
                    .setKey("key-" + offset)
                    .setValue(ByteString.copyFromUtf8("payload-" + offset))
                    .addTags("paid")
                    .putHeaders("traceparent", "00-test")
                    .setAckToken(token)
                    .setDeliveryCount(deliveryCount)
                    .setCode(Code.OK)
                    .build();
        }
    }
}
