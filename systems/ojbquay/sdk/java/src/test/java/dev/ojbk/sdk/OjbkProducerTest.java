package dev.ojbk.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ojbk.v1.Code;
import ojbk.v1.CancelDelayRequest;
import ojbk.v1.DelayRequest;
import ojbk.v1.DelayResponse;
import ojbk.v1.ProduceAck;
import ojbk.v1.ProduceRequest;
import ojbk.v1.ProduceResponse;
import ojbk.v1.ProducerServiceGrpc;
import io.grpc.Contexts;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.Server;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.StreamObserver;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class OjbkProducerTest {
    private final AtomicReference<String> observedToken = new AtomicReference<>();
    private final AtomicReference<Code> responseCode = new AtomicReference<>(Code.OK);
    private Server server;
    private ManagedChannel channel;
    private OjbkProducer producer;

    @BeforeEach
    void startServer() throws Exception {
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(io.grpc.ServerInterceptors.intercept(
                        new FakeProducerService(responseCode),
                        tokenInterceptor(observedToken)))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
        producer = new OjbkProducer(channel, "topic-token", Duration.ofSeconds(2), false);
    }

    @AfterEach
    void stopServer() throws Exception {
        producer.close();
        channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    void sendsSyncAndAsyncWithMetadataToken() throws Exception {
        OjbkMessage message = new OjbkMessage(
                "orders",
                "order-42",
                "payload".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                List.of("paid"),
                Map.of("traceparent", "00-test"),
                1);

        ProduceAcknowledgement sync = producer.send(message);
        ProduceAcknowledgement async = producer.sendAsync(message).get(2, TimeUnit.SECONDS);

        assertThat(sync).isEqualTo(new ProduceAcknowledgement("orders", 1, 42));
        assertThat(async).isEqualTo(sync);
        assertThat(observedToken).hasValue("topic-token");
    }

    @Test
    void raisesTypedBusinessFailureWithoutTurningItIntoTransportStatus() {
        responseCode.set(Code.QUOTA_EXCEEDED);

        assertThatThrownBy(() -> producer.send(OjbkMessage.ofUtf8("orders", "payload")))
                .isInstanceOf(OjbkException.class)
                .extracting(failure -> ((OjbkException) failure).code())
                .isEqualTo(Code.QUOTA_EXCEEDED);
    }

    @Test
    void schedulesAndCancelsWithTheSameStableDelayId() {
        String delayId = producer.schedule(
                OjbkMessage.ofUtf8("orders", "payload"),
                new DelaySchedule(
                        "delay-42",
                        Instant.parse("2026-07-29T12:01:00Z"),
                        Duration.ofSeconds(10),
                        3,
                        Instant.parse("2026-07-29T12:02:00Z")));

        assertThat(delayId).isEqualTo("delay-42");
        assertThat(producer.cancelDelay("orders", delayId)).isEqualTo("delay-42");
    }

    @Test
    void rejectsARecurrenceWithOnlyOneOccurrence() {
        assertThatThrownBy(() -> new DelaySchedule(
                        "delay-42",
                        Instant.parse("2026-07-29T12:01:00Z"),
                        Duration.ofSeconds(10),
                        1,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("2..10000");
    }

    private static ServerInterceptor tokenInterceptor(AtomicReference<String> observedToken) {
        Metadata.Key<String> token =
                Metadata.Key.of("x-ojbk-token", Metadata.ASCII_STRING_MARSHALLER);
        return new ServerInterceptor() {
            @Override
            public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(
                    ServerCall<ReqT, RespT> call,
                    Metadata headers,
                    ServerCallHandler<ReqT, RespT> next) {
                observedToken.set(headers.get(token));
                return Contexts.interceptCall(io.grpc.Context.current(), call, headers, next);
            }
        };
    }

    private static final class FakeProducerService
            extends ProducerServiceGrpc.ProducerServiceImplBase {
        private final AtomicReference<Code> responseCode;

        private FakeProducerService(AtomicReference<Code> responseCode) {
            this.responseCode = responseCode;
        }

        @Override
        public void produce(
                ProduceRequest request, StreamObserver<ProduceResponse> responseObserver) {
            Code code = responseCode.get();
            ProduceResponse.Builder response = ProduceResponse.newBuilder()
                    .setCode(code)
                    .setMsg(code == Code.OK ? "" : "business failure");
            if (code == Code.OK) {
                response.setAck(ProduceAck.newBuilder()
                        .setTopic(request.getMsg().getTopic())
                        .setPartition(1)
                        .setOffset(42));
            }
            responseObserver.onNext(response.build());
            responseObserver.onCompleted();
        }

        @Override
        public void produceDelay(
                DelayRequest request, StreamObserver<DelayResponse> responseObserver) {
            responseObserver.onNext(DelayResponse.newBuilder()
                    .setCode(Code.OK)
                    .setDelayId(request.getDelayId())
                    .build());
            responseObserver.onCompleted();
        }

        @Override
        public void cancelDelay(
                CancelDelayRequest request, StreamObserver<DelayResponse> responseObserver) {
            responseObserver.onNext(DelayResponse.newBuilder()
                    .setCode(Code.OK)
                    .setDelayId(request.getDelayId())
                    .build());
            responseObserver.onCompleted();
        }
    }
}
