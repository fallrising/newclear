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
    private final AtomicBoolean bootstrapComplete = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CountDownLatch terminated = new CountDownLatch(1);

    GatewayConsumeRuntime(GatewayConsumeSettings settings) {
        boolean resetConfigured = !settings.runtimeRoster().endpoints().isEmpty();
        if (resetConfigured) settings.runtimeRoster().requireMember(settings.instanceId());
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
                metrics,
                bootstrapComplete::get);
        String bootId = java.util.UUID.randomUUID().toString();
        metricsHttp.addReadOnlyStatus("/internal/pause-status", query -> {
            if (query == null || !query.matches("subscriptionId=[1-9][0-9]{0,18}"))
                throw new IllegalArgumentException("subscription ID required");
            var status = orchestrator.pauseStatus(settings.instanceId(), bootId,
                    settings.runtimeRoster().fingerprint(), Long.parseLong(query.substring(15)));
            if (!resetConfigured) {
                status = new dev.ojbk.config.RuntimePauseStatus(status.instanceId(), status.bootId(),
                        status.rosterFingerprint(), status.subscriptionId(), status.revision(), status.paused(),
                        false, false, status.bootstrapComplete());
            }
            return status.toJson();
        });
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
        // Push lifecycle runs on its bounded reconciler, never the config-bus poll thread.
        configBus.addListener(pullWorkers::onEvent);
        configBus.addDeletionListener(pullWorkers::onDeleted);
        configBus.addFailureListener(() -> {
            synchronized (bootstrapComplete) {
                bootstrapComplete.set(false);
                metricsHttp.setReady(false);
            }
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
            synchronized (bootstrapComplete) {
                if (!configBus.ready() || configBus.lastError().isPresent())
                    throw new IllegalStateException("config bus failed during startup");
                bootstrapComplete.set(true);
            }
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
            orchestrator.startReconciliation();
            synchronized (bootstrapComplete) {
                metricsHttp.setReady(configBus.ready() && configBus.lastError().isEmpty());
            }
        } catch (java.io.IOException failure) {
            try { close(); } catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
            throw new IllegalStateException("consumer gRPC server cannot start", failure);
        } catch (RuntimeException failure) {
            try { close(); } catch (RuntimeException cleanup) { failure.addSuppressed(cleanup); }
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
        bootstrapComplete.set(false);
        try {
            closeResources(() -> {
                grpcServer.shutdown();
                try {
                    if (!grpcServer.awaitTermination(10, TimeUnit.SECONDS)) grpcServer.shutdownNow();
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    grpcServer.shutdownNow();
                    throw new IllegalStateException("consumer gRPC stop interrupted", interrupted);
                }
            }, grpcExecutor, configBus, orchestrator, pullWorkers, retryPublisher, pipeline, metricsHttp);
        } finally { terminated.countDown(); }
    }

    static void closeResources(AutoCloseable... resources) {
        IllegalStateException aggregate = null;
        for (AutoCloseable resource : resources) {
            try { resource.close(); }
            catch (Exception failure) {
                if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
                if (aggregate == null) aggregate = new IllegalStateException("consumer resources did not all close");
                aggregate.addSuppressed(failure);
            }
        }
        if (aggregate != null) {
            LOGGER.log(System.Logger.Level.ERROR, "consumer resource shutdown incomplete", aggregate);
            throw aggregate;
        }
    }
}
