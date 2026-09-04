package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.protobuf.ByteString;
import ojbk.v1.AckRequest;
import ojbk.v1.Code;
import ojbk.v1.ConsumerServiceGrpc;
import ojbk.v1.MessageOut;
import ojbk.v1.PollRequest;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class ConsumerGrpcServiceTest {
    private final RecordingPullGateway gateway = new RecordingPullGateway();
    private io.grpc.Server server;
    private ManagedChannel channel;

    @BeforeEach
    void startServer() throws Exception {
        ConfigStore store = new ConfigStore();
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.GROUP,
                "settlement",
                1,
                Instant.EPOCH,
                "test",
                Map.of(
                        "name", "settlement",
                        "token", token(),
                        "owner", "alice",
                        "enabled", true)));
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(io.grpc.ServerInterceptors.intercept(
                        new ConsumerGrpcService(store, gateway),
                        new ConsumerTokenInterceptor()))
                .build()
                .start();
        channel = InProcessChannelBuilder.forName(name).directExecutor().build();
    }

    @AfterEach
    void stopServer() throws Exception {
        channel.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
        server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
    }

    @Test
    void metadataAuthStreamsDeliveryAndAckUsesBusinessResponse() {
        Metadata metadata = new Metadata();
        metadata.put(ConsumerTokenInterceptor.TOKEN_HEADER, token());
        var stub = ConsumerServiceGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));

        Iterator<MessageOut> stream = stub.poll(PollRequest.newBuilder()
                .setGroup("settlement")
                .setTopic("orders")
                .setToken("wrong-body-token")
                .setMaxBatch(10)
                .setLingerMs(250)
                .build());
        MessageOut delivery = stream.next();

        assertThat(delivery.getCode()).isEqualTo(Code.OK);
        assertThat(delivery.getTopic()).isEqualTo("orders");
        assertThat(delivery.getValue()).isEqualTo(ByteString.copyFromUtf8("payload"));
        assertThat(delivery.getDeliveryCount()).isEqualTo(2);
        assertThat(gateway.polls).hasValue(1);

        var response = stub.ack(AckRequest.newBuilder()
                .setGroup("settlement")
                .addAck(delivery.getAckToken())
                .build());
        assertThat(response.getCode()).isEqualTo(Code.OK);
        assertThat(gateway.acks).hasValue(1);
    }

    @Test
    void invalidAuthenticationIsAStablePollBusinessFrame() {
        var stub = ConsumerServiceGrpc.newBlockingStub(channel);

        MessageOut failure = stub.poll(PollRequest.newBuilder()
                        .setGroup("settlement")
                        .setTopic("orders")
                        .setToken("wrong")
                        .setMaxBatch(1)
                        .build())
                .next();

        assertThat(failure.getCode()).isEqualTo(Code.AUTH_FAILED);
        assertThat(failure.getMsg()).isNotBlank();
        assertThat(gateway.polls).hasValue(0);
    }

    private static String token() {
        return "abcdef0123456789abcdef0123456789";
    }

    private static final class RecordingPullGateway implements PullGateway {
        private final AtomicInteger polls = new AtomicInteger();
        private final AtomicInteger acks = new AtomicInteger();

        @Override
        public PullPollResult poll(
                String group, String topic, int maxBatch, Duration linger) {
            polls.incrementAndGet();
            return PullPollResult.ok(List.of(new PullDelivery(
                    topic,
                    1,
                    42,
                    Instant.EPOCH,
                    "order-42",
                    "payload".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    List.of("paid"),
                    Map.of("traceparent", "00-test"),
                    "ack-token",
                    2)));
        }

        @Override
        public PullAckResult acknowledge(
                String group,
                List<String> accepted,
                List<String> released,
                Duration timeout) {
            acks.incrementAndGet();
            return PullAckResult.ok();
        }
    }
}
