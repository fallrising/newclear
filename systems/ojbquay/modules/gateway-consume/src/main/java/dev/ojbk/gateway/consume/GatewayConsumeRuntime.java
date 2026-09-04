package dev.ojbk.gateway.consume;

import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.KafkaConfigBusClient;
import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import dev.ojbk.observability.MetricsHttp;
import dev.ojbk.messaging.MessageLimits;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.net.InetSocketAddress;
import java.time.Clock;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class GatewayConsumeRuntime implements AutoCloseable {
    private static final System.Logger LOGGER =
            System.getLogger(GatewayConsumeRuntime.class.getName());

    private final ConsumeMetrics metrics;
    private final MetricsHttp metricsHttp;
    private final PushPipeline pipeline;
    private final JdkPushHttpClient http;
    private final KafkaRetryPublisher retryPublisher;
    private final PushWorkerOrchestrator orchestrator;
    private final PullWorkerRegistry pullWorkers;
    private final KafkaConfigBusClient configBus;
    private final ExecutorService grpcExecutor;
    private final Server grpcServer;
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CountDownLatch terminated = new CountDownLatch(1);

    GatewayConsumeRuntime(GatewayConsumeSettings settings) {
        metrics = new ConsumeMetrics();
        metricsHttp = new MetricsHttp(
                new InetSocketAddress("0.0.0.0", settings.metricsPort()), metrics::scrape);
        metricsHttp.start();
        pipeline = new PushPipeline();
        http = new JdkPushHttpClient();
        retryPublisher = new KafkaRetryPublisher(settings.kafkaBootstrapServers());
        ConfigStore store = new ConfigStore();
        orchestrator = new PushWorkerOrchestrator(
                store,
                subscription -> worker(settings, subscription),
                metrics);
        pullWorkers = new PullWorkerRegistry(
                store,
                subscription -> new PullShareWorker(
                        new KafkaPullBroker(
                                settings.kafkaBootstrapServers(), subscription),
                        subscription,
                        pipeline,
                        (message, topic, reason) ->
                                retryPublisher.publishDlq(message, topic, reason),
                        Clock.systemUTC(),
                        metrics));
        configBus = new KafkaConfigBusClient(
                settings.kafkaBootstrapServers(),
                "gateway-consume",
                settings.instanceId(),
                store);
        configBus.addListener(event -> {
            orchestrator.onEvent(event);
            pullWorkers.onEvent(event);
        });
        configBus.addDeletionListener((type, entityId) -> {
            orchestrator.onDeleted(type, entityId);
            pullWorkers.onDeleted(type, entityId);
        });
        grpcExecutor = Executors.newVirtualThreadPerTaskExecutor();
        grpcServer = NettyServerBuilder.forPort(settings.grpcPort())
                .maxInboundMessageSize(MessageLimits.MAX_KAFKA_REQUEST_BYTES)
                .executor(grpcExecutor)
                .addService(ServerInterceptors.intercept(
                        new ConsumerGrpcService(store, pullWorkers),
                        new ConsumerTokenInterceptor()))
                .build();
        try {
            configBus.start();
            awaitConfig(settings.configBootstrapTimeout());
            orchestrator.reconcileAll();
            pullWorkers.reconcileAll();
            if (orchestrator.lastError().isPresent()
                    || pullWorkers.lastError().isPresent()) {
                throw new IllegalStateException(
                        "consumer worker reconciliation failed: "
                                + orchestrator.lastError()
                                        .or(() -> pullWorkers.lastError())
                                        .orElseThrow());
            }
            grpcServer.start();
            metricsHttp.setReady(true);
        } catch (java.io.IOException failure) {
            close();
            throw new IllegalStateException("consumer gRPC server cannot start", failure);
        } catch (RuntimeException failure) {
            close();
            throw failure;
        }
        LOGGER.log(
                System.Logger.Level.INFO,
                "gateway-consume ready with {0} push and {1} pull workers, gRPC port {2}, metrics port {3}",
                orchestrator.workerCount(),
                pullWorkers.workerCount(),
                settings.grpcPort(),
                settings.metricsPort());
    }

    public static void main(String[] arguments) throws InterruptedException {
        GatewayConsumeSettings settings = GatewayConsumeSettings.from(System.getenv());
        try (GatewayConsumeRuntime runtime = new GatewayConsumeRuntime(settings)) {
            Runtime.getRuntime().addShutdownHook(Thread.ofPlatform()
                    .name("ojbquay-consume-shutdown")
                    .unstarted(runtime::close));
            runtime.awaitTermination();
        }
    }

    private PushSubscriptionWorker worker(
            GatewayConsumeSettings settings, SubscriptionConfig subscription) {
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(subscription.spec());
        pipeline.validate(spec);
        DeliveryRateGate rate = new FixedRateGate(spec.maxTps());
        if (spec.ordered()) {
            return new KafkaOrderedPushWorker(
                    settings.kafkaBootstrapServers(),
                    subscription,
                    new OrderedPushRecordHandler(
                            pipeline, http, retryPublisher, rate, metrics));
        }
        return new KafkaSharePushWorker(
                settings.kafkaBootstrapServers(),
                subscription,
                new PushRecordHandler(
                        pipeline,
                        http,
                        retryPublisher,
                        Clock.systemUTC(),
                        rate,
                        metrics));
    }

    private void awaitConfig(Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!configBus.ready() && System.nanoTime() < deadline) {
            if (configBus.lastError().isPresent()) {
                throw new IllegalStateException(
                        "config bootstrap failed: " + configBus.lastError().orElseThrow());
            }
            try {
                Thread.sleep(25);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("config bootstrap was interrupted", interrupted);
            }
        }
        if (!configBus.ready()) {
            throw new IllegalStateException("config bootstrap timed out");
        }
    }

    private void awaitTermination() throws InterruptedException {
        terminated.await();
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
        configBus.close();
        orchestrator.close();
        pullWorkers.close();
        retryPublisher.close();
        pipeline.close();
        metricsHttp.close();
        terminated.countDown();
    }
}
