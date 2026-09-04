package dev.ojbk.gateway.produce;

import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.KafkaConfigBusClient;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.observability.MetricsHttp;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class GatewayProduceRuntime implements AutoCloseable {
    private static final System.Logger LOGGER =
            System.getLogger(GatewayProduceRuntime.class.getName());

    private final MetricsHttp metricsHttp;
    private final KafkaConfigBusClient configBus;
    private final KafkaBrokerProducer broker;
    private final KafkaDelayCommandPublisher delayPublisher;
    private final ExecutorService grpcExecutor;
    private final Server grpcServer;
    private final AtomicBoolean closed = new AtomicBoolean();

    private GatewayProduceRuntime(GatewaySettings settings) {
        ProducerMetrics metrics = new ProducerMetrics();
        this.metricsHttp = new MetricsHttp(
                new InetSocketAddress("0.0.0.0", settings.metricsPort()), metrics::scrape);
        this.metricsHttp.start();
        ConfigStore store = new ConfigStore();
        this.configBus = new KafkaConfigBusClient(
                settings.kafkaBootstrapServers(),
                "gateway-produce",
                settings.instanceId(),
                store);
        this.configBus.start();
        awaitConfig(settings.configBootstrapTimeout());

        try {
            this.broker = new KafkaBrokerProducer(settings.kafkaBootstrapServers());
        } catch (RuntimeException failure) {
            closeBeforeServer();
            throw failure;
        }
        try {
            this.delayPublisher =
                    new KafkaDelayCommandPublisher(settings.kafkaBootstrapServers());
        } catch (RuntimeException failure) {
            broker.close();
            closeBeforeServer();
            throw failure;
        }
        this.grpcExecutor = Executors.newVirtualThreadPerTaskExecutor();
        ProducerEngine engine = new ProducerEngine(store, broker, metrics);
        DelayGateway delay =
                new DelayGateway(engine, delayPublisher, settings.delayDirectThreshold());
        try {
            this.grpcServer = NettyServerBuilder.forPort(settings.grpcPort())
                    .maxInboundMessageSize(MessageLimits.MAX_KAFKA_REQUEST_BYTES)
                    .executor(grpcExecutor)
                    .addService(ServerInterceptors.intercept(
                            new ProducerGrpcService(engine, delay),
                            new TokenMetadataInterceptor()))
                    .build()
                    .start();
        } catch (java.io.IOException failure) {
            grpcExecutor.close();
            delayPublisher.close();
            broker.close();
            closeBeforeServer();
            throw new IllegalStateException("gRPC server cannot start", failure);
        }
        metricsHttp.setReady(true);
        LOGGER.log(
                System.Logger.Level.INFO,
                "gateway-produce ready on gRPC port {0}, metrics port {1}",
                settings.grpcPort(),
                settings.metricsPort());
    }

    public static void main(String[] arguments) throws InterruptedException {
        GatewaySettings settings = GatewaySettings.from(System.getenv());
        try (GatewayProduceRuntime runtime = new GatewayProduceRuntime(settings)) {
            Runtime.getRuntime().addShutdownHook(
                    Thread.ofPlatform().name("ojbquay-shutdown").unstarted(runtime::close));
            runtime.awaitTermination();
        }
    }

    private void awaitConfig(Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!configBus.ready() && System.nanoTime() < deadline) {
            if (configBus.lastError().isPresent()) {
                closeBeforeServer();
                throw new IllegalStateException(
                        "config bootstrap failed: " + configBus.lastError().orElseThrow());
            }
            try {
                Thread.sleep(25);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                closeBeforeServer();
                throw new IllegalStateException("config bootstrap was interrupted", interrupted);
            }
        }
        if (!configBus.ready()) {
            closeBeforeServer();
            throw new IllegalStateException("config bootstrap timed out");
        }
    }

    private void awaitTermination() throws InterruptedException {
        grpcServer.awaitTermination();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }
        metricsHttp.setReady(false);
        grpcServer.shutdown();
        try {
            if (!grpcServer.awaitTermination(10, TimeUnit.SECONDS)) {
                grpcServer.shutdownNow();
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            grpcServer.shutdownNow();
        }
        grpcExecutor.close();
        delayPublisher.close();
        broker.close();
        configBus.close();
        metricsHttp.close();
    }

    private void closeBeforeServer() {
        configBus.close();
        metricsHttp.close();
    }
}
