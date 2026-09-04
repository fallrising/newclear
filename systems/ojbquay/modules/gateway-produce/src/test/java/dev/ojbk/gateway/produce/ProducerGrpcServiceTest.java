package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.protobuf.ByteString;
import ojbk.v1.Code;
import ojbk.v1.MessageIn;
import ojbk.v1.ProduceRequest;
import ojbk.v1.ProduceResponse;
import ojbk.v1.ProducerServiceGrpc;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import io.grpc.ManagedChannel;
import io.grpc.Metadata;
import io.grpc.inprocess.InProcessChannelBuilder;
import io.grpc.inprocess.InProcessServerBuilder;
import io.grpc.stub.MetadataUtils;
import io.grpc.stub.StreamObserver;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class ProducerGrpcServiceTest {
    private final RecordingBroker broker = new RecordingBroker();
    private io.grpc.Server server;
    private ManagedChannel channel;

    @BeforeEach
    void startServer() throws Exception {
        ConfigStore store = new ConfigStore();
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                1,
                Instant.parse("2026-07-29T12:00:00Z"),
                "test",
                Map.ofEntries(
                        Map.entry("name", "orders"),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", false),
                        Map.entry("maxMessageBytes", 1_024),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 100),
                        Map.entry("token", token()),
                        Map.entry("owner", "alice"),
                        Map.entry("enabled", true))));
        String name = InProcessServerBuilder.generateName();
        server = InProcessServerBuilder.forName(name)
                .directExecutor()
                .addService(io.grpc.ServerInterceptors.intercept(
                        new ProducerGrpcService(new ProducerEngine(store, broker)),
                        new TokenMetadataInterceptor()))
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
    void metadataTokenOverridesBodyTokenAndReturnsBusinessResponse() {
        Metadata metadata = new Metadata();
        metadata.put(TokenMetadataInterceptor.TOKEN_HEADER, token());
        var stub = ProducerServiceGrpc.newBlockingStub(channel)
                .withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));

        ProduceResponse response = stub.produce(request("wrong-body-token", "first"));

        assertThat(response.getCode()).isEqualTo(Code.OK);
        assertThat(response.getAck().getPartition()).isZero();
        assertThat(response.getAck().getOffset()).isEqualTo(0);
        assertThat(broker.records).hasSize(1);
    }

    @Test
    void streamsBatchResponsesInRequestOrder() throws Exception {
        List<ProduceResponse> responses = new ArrayList<>();
        CountDownLatch completed = new CountDownLatch(1);
        StreamObserver<ProduceRequest> requests =
                ProducerServiceGrpc.newStub(channel).produceBatch(new StreamObserver<>() {
                    @Override
                    public void onNext(ProduceResponse response) {
                        responses.add(response);
                    }

                    @Override
                    public void onError(Throwable failure) {
                        completed.countDown();
                    }

                    @Override
                    public void onCompleted() {
                        completed.countDown();
                    }
                });

        requests.onNext(request(token(), "first"));
        requests.onNext(request(token(), "second"));
        requests.onCompleted();

        assertThat(completed.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(responses).extracting(response -> response.getAck().getOffset())
                .containsExactly(0L, 1L);
    }

    private static ProduceRequest request(String token, String value) {
        return ProduceRequest.newBuilder()
                .setToken(token)
                .setMsg(MessageIn.newBuilder()
                        .setTopic("orders")
                        .setValue(ByteString.copyFromUtf8(value)))
                .build();
    }

    private static String token() {
        return "0123456789abcdef0123456789abcdef";
    }

    private static final class RecordingBroker implements BrokerProducer {
        private final List<BrokerRecord> records = new ArrayList<>();

        @Override
        public BrokerAck send(BrokerRecord record) {
            records.add(record);
            return new BrokerAck(record.topic(), 0, records.size() - 1L);
        }
    }
}
