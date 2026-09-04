package dev.ojbk.scheduler;

import dev.ojbk.delay.DelayCommand;
import dev.ojbk.observability.MetricsHttp;
import java.net.InetSocketAddress;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.common.errors.WakeupException;
import org.postgresql.ds.PGSimpleDataSource;

public final class SchedulerRuntime implements AutoCloseable {
    private static final System.Logger LOGGER =
            System.getLogger(SchedulerRuntime.class.getName());
    private static final Duration FAILURE_BACKOFF = Duration.ofSeconds(1);
    private static final Duration CLEANUP_INTERVAL = Duration.ofHours(1);
    private static final Duration METRICS_SCAN_INTERVAL = Duration.ofSeconds(10);

    private final SchedulerSettings settings;
    private final Clock clock;
    private final SchedulerMetrics metrics;
    private final MetricsHttp metricsHttp;
    private final KafkaDelayIngestor ingestor;
    private final KafkaDelaySender sender;
    private final DelayDispatcher dispatcher;
    private final ExecutorService workers;
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final AtomicBoolean closed = new AtomicBoolean();
    private final CountDownLatch terminated = new CountDownLatch(1);

    private SchedulerRuntime(SchedulerSettings settings) {
        this(settings, Clock.systemUTC());
    }

    SchedulerRuntime(SchedulerSettings settings, Clock clock) {
        this.settings = Objects.requireNonNull(settings, "settings");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.metrics = new SchedulerMetrics();
        this.metricsHttp = new MetricsHttp(
                new InetSocketAddress("0.0.0.0", settings.metricsPort()), metrics::scrape);
        metricsHttp.start();

        PGSimpleDataSource dataSource = dataSource(settings);
        try {
            verifySchema(dataSource);
            verifyInbox(settings.kafkaBootstrapServers());
        } catch (RuntimeException failure) {
            metricsHttp.close();
            throw failure;
        }
        JdbcDelayRepository repository = new JdbcDelayRepository(dataSource);
        this.ingestor = new KafkaDelayIngestor(
                settings.kafkaBootstrapServers(), settings.instanceId(), repository, metrics);
        this.sender = new KafkaDelaySender(settings.kafkaBootstrapServers());
        this.dispatcher =
                new DelayDispatcher(repository, sender, metrics, JdbcDelayRepository.MAX_BATCH);
        this.workers = Executors.newVirtualThreadPerTaskExecutor();
        workers.submit(this::ingestLoop);
        for (int index = 0; index < settings.dispatcherWorkers(); index++) {
            boolean ownsCleanup = index == 0;
            workers.submit(() -> dispatchLoop(ownsCleanup));
        }
        metricsHttp.setReady(true);
        LOGGER.log(
                System.Logger.Level.INFO,
                "scheduler ready with {0} dispatch workers, metrics port {1}",
                settings.dispatcherWorkers(),
                settings.metricsPort());
    }

    public static void main(String[] arguments) throws InterruptedException {
        SchedulerSettings settings = SchedulerSettings.from(System.getenv());
        try (SchedulerRuntime runtime = new SchedulerRuntime(settings)) {
            Runtime.getRuntime().addShutdownHook(
                    Thread.ofPlatform().name("ojbquay-scheduler-shutdown").unstarted(runtime::close));
            runtime.awaitTermination();
        }
    }

    private void ingestLoop() {
        while (running.get()) {
            try {
                ingestor.pollOnce(settings.pollTimeout());
            } catch (WakeupException wakeup) {
                if (running.get()) {
                    metrics.recordFailure();
                    recordWorkerFailure("delay inbox consumer was woken unexpectedly", wakeup);
                }
            } catch (RuntimeException failure) {
                recordWorkerFailure("delay inbox ingestion failed", failure);
                pause(FAILURE_BACKOFF);
            }
        }
    }

    private void dispatchLoop(boolean ownsCleanup) {
        long nextCleanup = System.nanoTime() + CLEANUP_INTERVAL.toNanos();
        long nextMetricsScan = System.nanoTime();
        while (running.get()) {
            try {
                dispatcher.tick(clock.instant());
                if (ownsCleanup && System.nanoTime() >= nextMetricsScan) {
                    dispatcher.refreshPending();
                    nextMetricsScan =
                            System.nanoTime() + METRICS_SCAN_INTERVAL.toNanos();
                }
                if (ownsCleanup && System.nanoTime() >= nextCleanup) {
                    Instant before = clock.instant().minus(settings.terminalRetention());
                    dispatcher.cleanup(before);
                    nextCleanup = System.nanoTime() + CLEANUP_INTERVAL.toNanos();
                }
            } catch (RuntimeException failure) {
                recordWorkerFailure("delay dispatch failed", failure);
                pause(FAILURE_BACKOFF);
            }
            pause(settings.dispatchTick());
        }
    }

    private void recordWorkerFailure(String message, RuntimeException failure) {
        LOGGER.log(System.Logger.Level.ERROR, message, failure);
    }

    private void pause(Duration duration) {
        if (!running.get()) {
            return;
        }
        try {
            Thread.sleep(duration);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            running.set(false);
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
        running.set(false);
        ingestor.wakeup();
        workers.shutdown();
        try {
            if (!workers.awaitTermination(10, TimeUnit.SECONDS)) {
                workers.shutdownNow();
                workers.awaitTermination(10, TimeUnit.SECONDS);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            workers.shutdownNow();
        }
        ingestor.close();
        sender.close();
        metricsHttp.close();
        terminated.countDown();
    }

    private static PGSimpleDataSource dataSource(SchedulerSettings settings) {
        PGSimpleDataSource dataSource = new PGSimpleDataSource();
        dataSource.setURL(settings.databaseUrl());
        dataSource.setUser(settings.databaseUser());
        dataSource.setPassword(settings.databasePassword());
        return dataSource;
    }

    private static void verifySchema(PGSimpleDataSource dataSource) {
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute("SELECT delay_id FROM delay_message LIMIT 0");
        } catch (SQLException failure) {
            throw new IllegalStateException(
                    "delay schema is unavailable; run control-plane migrations first", failure);
        }
    }

    private static void verifyInbox(String bootstrapServers) {
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", bootstrapServers))) {
            admin.describeTopics(java.util.List.of(DelayCommand.INBOX_TOPIC))
                    .allTopicNames()
                    .get(30, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("delay inbox verification was interrupted", interrupted);
        } catch (java.util.concurrent.ExecutionException
                | java.util.concurrent.TimeoutException failure) {
            throw new IllegalStateException(
                    "delay inbox is unavailable; start the control plane first", failure);
        }
    }
}
