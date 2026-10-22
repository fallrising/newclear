package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.KafkaConfigBusClient;
import dev.ojbk.config.KafkaConfigPublisher;
import dev.ojbk.config.RuntimePauseStatus;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;

@Testcontainers
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
final class RuntimeRecoveryAc09IntegrationTest {
    @Container static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:4.2.0");

    @BeforeAll static void createConfigTopic() throws Exception {
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic(KafkaConfigPublisher.CONFIG_TOPIC, 1, (short) 1)
                    .configs(Map.of("cleanup.policy", "compact")))).all().get(10, TimeUnit.SECONDS);
        }
    }

    @Test @Order(1)
    void AC_09_unconfiguredStandaloneStartsButCannotConfirmReset() throws Exception {
        try (var publisher = new KafkaConfigPublisher(KAFKA.getBootstrapServers())) {
            publisher.publish(event("99", 1, false));
        }
        int metrics = freePort();
        var settings = GatewayConsumeSettings.from(Map.of(
                "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", KAFKA.getBootstrapServers(),
                "OJBQUAY_INSTANCE_ID", "standalone-test",
                "OJBQUAY_GRPC_PORT", Integer.toString(freePort()),
                "OJBQUAY_METRICS_PORT", Integer.toString(metrics)));
        try (var runtime = new GatewayConsumeRuntime(settings)) {
            assertThat(runtime).isNotNull();
            assertThat(get(metrics, "/readyz").statusCode()).isEqualTo(200);
            var status = RuntimePauseStatus.fromJson(get(metrics, "/internal/pause-status?subscriptionId=99").body());
            assertThat(status.paused()).isTrue();
            assertThat(status.fetchStopped()).isFalse();
            assertThat(status.inflightSettled()).isFalse();
        }
    }

    @Test @Order(2)
    void AC_09_realConfigBusSurvivesFailedStopAndObservesLaterTermination() throws Exception {
        ConfigStore store = new ConfigStore();
        AtomicBoolean terminated = new AtomicBoolean();
        AtomicInteger stops = new AtomicInteger();
        PushSubscriptionWorker worker = new PushSubscriptionWorker() {
            public void start() { }
            public boolean running() { return !terminated.get(); }
            public Optional<String> lastError() { return Optional.empty(); }
            public long acceptedCount() { return 0; }
            public void close() {
                stops.incrementAndGet();
                if (!terminated.get()) throw new IllegalStateException("handler remains inflight");
            }
        };
        var orchestrator = new PushWorkerOrchestrator(store, ignored -> worker);
        try (var publisher = new KafkaConfigPublisher(KAFKA.getBootstrapServers());
                var client = new KafkaConfigBusClient(KAFKA.getBootstrapServers(), "recovery-test", "one", store)) {
            client.start();
            await(() -> client.ready());
            orchestrator.startReconciliation();
            publisher.publish(event("1", 1, true));
            await(() -> orchestrator.configVersion("1") == 1);
            publisher.publish(event("1", 2, false));
            await(() -> stops.get() > 0);
            publisher.publish(event("2", 1, false));
            await(() -> store.get(ConfigEntityType.SUBSCRIPTION, "2").isPresent());
            assertThat(client.ready()).isTrue();
            assertThat(client.lastError()).isEmpty();
            assertThat(orchestrator.configVersion("1")).isEqualTo(1);
            assertThat(orchestrator.pauseStatus("one", "boot", "roster", 1).fetchStopped()).isFalse();
            terminated.set(true);
            await(() -> orchestrator.pauseStatus("one", "boot", "roster", 1).fetchStopped());
            assertThat(orchestrator.configVersion("1")).isEqualTo(2);
        } finally { terminated.set(true); orchestrator.close(); }
    }

    @Test @Order(3)
    void AC_09_realOrderedHandlerEventuallyStopsWhileConfigPollKeepsProgressing() throws Exception {
        try (Admin admin = Admin.create(Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(new NewTopic("orders", 1, (short) 1),
                    new NewTopic("orders.group.retry", 1, (short) 1))).all().get(10, TimeUnit.SECONDS);
        }
        var entered = new java.util.concurrent.CountDownLatch(1);
        var interrupted = new java.util.concurrent.CountDownLatch(1);
        var release = new java.util.concurrent.CountDownLatch(1);
        PushHttpClient http = ignored -> {
            entered.countDown();
            while (release.getCount() != 0) {
                try { release.await(); }
                catch (InterruptedException expected) { interrupted.countDown(); }
            }
            return PushHttpResult.http(204, 1);
        };
        RetryPublisher retries = new RetryPublisher() {
            public void schedule(PushMessage message, String topic, Instant due, int count) { }
            public void publishDlq(PushMessage message, String topic, String reason) { }
        };
        ConfigStore store = new ConfigStore();
        try (var pipeline = new PushPipeline();
                var publisher = new KafkaConfigPublisher(KAFKA.getBootstrapServers());
                var client = new KafkaConfigBusClient(KAFKA.getBootstrapServers(), "real-worker-recovery", "one", store)) {
            var orchestrator = new PushWorkerOrchestrator(store, subscription -> new KafkaOrderedPushWorker(
                    KAFKA.getBootstrapServers(), subscription,
                    new OrderedPushRecordHandler(pipeline, http, retries, () -> true)));
            try {
                client.start(); await(client::ready); orchestrator.startReconciliation();
                publisher.publish(event("3", 1, true));
                await(() -> orchestrator.configVersion("3") == 1);
                publishBytes("orders", "key", "{\"generated\":true}");
                assertThat(entered.await(10, TimeUnit.SECONDS)).isTrue();
                publisher.publish(event("3", 2, false));
                assertThat(interrupted.await(5, TimeUnit.SECONDS)).isTrue();
                long started = System.nanoTime();
                publisher.publish(event("4", 1, false));
                await(() -> store.get(ConfigEntityType.SUBSCRIPTION, "4").isPresent());
                assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));
                await(() -> orchestrator.lastError().isPresent());
                assertThat(orchestrator.configVersion("3")).isEqualTo(1);
                assertThat(orchestrator.pauseStatus("one", "boot", "roster", 3).fetchStopped()).isFalse();
                assertThat(client.ready()).isTrue();
                release.countDown();
                await(() -> orchestrator.pauseStatus("one", "boot", "roster", 3).inflightSettled());
                assertThat(orchestrator.configVersion("3")).isEqualTo(2);
                assertThat(client.lastError()).isEmpty();
            } finally { release.countDown(); orchestrator.close(); }
        }
    }

    @Test @Order(4)
    void AC_09_fatalConfigBusFailureLowersRuntimeReadinessAndConfirmation() throws Exception {
        int metrics = freePort();
        var settings = GatewayConsumeSettings.from(Map.of(
                "OJBQUAY_KAFKA_BOOTSTRAP_SERVERS", KAFKA.getBootstrapServers(),
                "OJBQUAY_INSTANCE_ID", "fatal-test",
                "OJBQUAY_CONSUME_RUNTIME_ROSTER", "fatal-test=http://127.0.0.1:" + metrics,
                "OJBQUAY_GRPC_PORT", Integer.toString(freePort()),
                "OJBQUAY_METRICS_PORT", Integer.toString(metrics)));
        try (var runtime = new GatewayConsumeRuntime(settings)) {
            assertThat(runtime).isNotNull();
            assertThat(get(metrics, "/readyz").statusCode()).isEqualTo(200);
            publishBytes(KafkaConfigPublisher.CONFIG_TOPIC, "bad", "not-json");
            await(() -> {
                try { return get(metrics, "/readyz").statusCode() == 503; }
                catch (Exception failure) { throw new IllegalStateException(failure); }
            });
            var status = RuntimePauseStatus.fromJson(get(metrics, "/internal/pause-status?subscriptionId=99").body());
            assertThat(status.bootstrapComplete()).isFalse();
            assertThat(status.fetchStopped()).isFalse();
        }
    }

    private static void publishBytes(String topic, String key, String value) throws Exception {
        var properties = new java.util.Properties();
        properties.put("bootstrap.servers", KAFKA.getBootstrapServers());
        properties.put("key.serializer", "org.apache.kafka.common.serialization.ByteArraySerializer");
        properties.put("value.serializer", "org.apache.kafka.common.serialization.ByteArraySerializer");
        try (var producer = new org.apache.kafka.clients.producer.KafkaProducer<byte[], byte[]>(properties)) {
            producer.send(new org.apache.kafka.clients.producer.ProducerRecord<>(topic,
                    key.getBytes(java.nio.charset.StandardCharsets.UTF_8),
                    value.getBytes(java.nio.charset.StandardCharsets.UTF_8))).get(10, TimeUnit.SECONDS);
        }
    }

    static ConfigEvent event(String id, long revision, boolean enabled) {
        return new ConfigEvent(1, ConfigEntityType.SUBSCRIPTION, id, revision, Instant.now(), "test",
                Map.of("id", Long.parseLong(id), "group", "group", "topic", "orders", "owner", "test",
                        "enabled", enabled, "spec", Map.of("mode", "PUSH", "concurrency", 1,
                                "maxTps", 100, "ordered", true, "orderKeySource", "KEY",
                                "push", Map.of("urls", List.of("http://example.test"), "method", "POST",
                                        "timeoutMs", 1000, "retryIntervalsMs", List.of(150)))));
    }
    private static int freePort() throws Exception {
        try (var socket = new ServerSocket(0)) { return socket.getLocalPort(); }
    }
    private static HttpResponse<String> get(int port, String path) throws Exception {
        try (var client = HttpClient.newHttpClient()) {
            return client.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                    .timeout(Duration.ofSeconds(2)).GET().build(), HttpResponse.BodyHandlers.ofString());
        }
    }
    private static void await(java.util.function.BooleanSupplier condition) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (!condition.getAsBoolean() && System.nanoTime() < deadline) Thread.sleep(25);
        assertThat(condition.getAsBoolean()).isTrue();
    }
}
