package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import dev.ojbk.config.SubscriptionConfig;
import dev.ojbk.delay.DelayCommand;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.scheduler.DelayDispatcher;
import dev.ojbk.scheduler.JdbcDelayRepository;
import dev.ojbk.scheduler.KafkaDelayIngestor;
import dev.ojbk.scheduler.KafkaDelaySender;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.postgresql.ds.PGConnectionPoolDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
final class PushRetryE2eTest {
    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0")
                    .withEnv("KAFKA_SHARE_COORDINATOR_STATE_TOPIC_REPLICATION_FACTOR", "1")
                    .withEnv("KAFKA_SHARE_COORDINATOR_STATE_TOPIC_MIN_ISR", "1");

    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:17");

    private static PGSimpleDataSource dataSource;

    @BeforeAll
    static void createDelaySchemaAndInbox() throws Exception {
        dataSource = new PGSimpleDataSource();
        dataSource.setURL(POSTGRES.getJdbcUrl());
        dataSource.setUser(POSTGRES.getUsername());
        dataSource.setPassword(POSTGRES.getPassword());
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute("""
                    CREATE TABLE delay_message (
                      delay_id TEXT PRIMARY KEY,
                      target_topic TEXT NOT NULL,
                      due_at TIMESTAMPTZ NOT NULL,
                      payload BYTEA NOT NULL,
                      headers JSONB NOT NULL DEFAULT '{}',
                      msg_key TEXT,
                      loop_interval_ms BIGINT,
                      loop_remaining INT,
                      expire_at TIMESTAMPTZ,
                      status SMALLINT NOT NULL DEFAULT 0,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      fired_at TIMESTAMPTZ
                    )
                    """);
            statement.execute("""
                    CREATE INDEX idx_delay_due
                      ON delay_message (due_at)
                      WHERE status = 0
                    """);
        }
        createTopics(List.of(topic(
                DelayCommand.INBOX_TOPIC, 12, MessageLimits.MAX_DELAY_COMMAND_BYTES)));
    }

    @Test
    void AC_05_schedulesThreeRetriesThenWritesFourthFailureToDlq() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8);
        String source = "retry-e2e-" + suffix;
        String group = "push-" + suffix;
        String retry = source + "." + group + ".retry";
        String dlq = source + "." + group + ".dlq";
        createTopics(List.of(
                topic(source, 1, MessageLimits.MAX_KAFKA_REQUEST_BYTES),
                topic(retry, 1, MessageLimits.MAX_KAFKA_REQUEST_BYTES),
                topic(dlq, 1, MessageLimits.MAX_KAFKA_REQUEST_BYTES)));

        List<Instant> attempts = new CopyOnWriteArrayList<>();
        List<Instant> completions = new CopyOnWriteArrayList<>();
        List<TimingEvent> timeline = new CopyOnWriteArrayList<>();
        List<String> bodies = new CopyOnWriteArrayList<>();
        List<String> traces = new CopyOnWriteArrayList<>();
        HttpServer endpoint = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        ExecutorService endpointExecutor = Executors.newVirtualThreadPerTaskExecutor();
        endpoint.setExecutor(endpointExecutor);
        endpoint.createContext("/push", exchange -> {
            String body = new String(
                    exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            attempts.add(Instant.now());
            timeline.add(new TimingEvent("http_attempt_at", attempts.getLast().toEpochMilli()));
            bodies.add(body);
            traces.add(exchange.getRequestHeaders().getFirst("traceparent"));
            exchange.sendResponseHeaders(503, -1);
            timeline.add(new TimingEvent("http_response_sent", Instant.now().toEpochMilli()));
            exchange.close();
        });
        endpoint.start();

        SubscriptionConfig subscription =
                subscription(source, group, endpoint.getAddress().getPort());
        PGConnectionPoolDataSource workerDataSource = new PGConnectionPoolDataSource();
        workerDataSource.setURL(POSTGRES.getJdbcUrl());
        workerDataSource.setUser(POSTGRES.getUsername());
        workerDataSource.setPassword(POSTGRES.getPassword());
        try (JdbcDelayRepository repository = JdbcDelayRepository.forWorker(workerDataSource);
                JdbcDelayRepository ingestionRepository = JdbcDelayRepository.forWorker(workerDataSource);
                KafkaRetryPublisher retryPublisher =
                        new KafkaRetryPublisher(KAFKA.getBootstrapServers());
                PushPipeline pipeline = new PushPipeline();
                KafkaDelayIngestor ingestor = new KafkaDelayIngestor(
                        KAFKA.getBootstrapServers(), suffix, observed(ingestionRepository, timeline));
                KafkaDelaySender sender = new KafkaDelaySender(KAFKA.getBootstrapServers());
                KafkaConsumer<String, byte[]> dlqConsumer = consumer(dlq);
                KafkaSharePushWorker worker = new KafkaSharePushWorker(
                        KAFKA.getBootstrapServers(),
                        subscription,
                        new PushRecordHandler(
                                pipeline,
                                diagnosticHttp(timeline, completions),
                                retryPublisher,
                                Clock.systemUTC()))) {
            DelayDispatcher dispatcher = new DelayDispatcher(observed(repository, timeline), delivery -> {
                timeline.add(new TimingEvent("dispatch_due", delivery.dueAt().toEpochMilli()));
                timeline.add(new TimingEvent("dispatch_started", Instant.now().toEpochMilli()));
                sender.send(delivery);
                timeline.add(new TimingEvent("dispatch_sent", Instant.now().toEpochMilli()));
            });
            ingestor.pollOnce(Duration.ofMillis(500));
            dlqConsumer.poll(Duration.ofMillis(100));
            worker.start();
            publish(
                    source,
                    "order-42",
                    "{\"id\":42,\"user\":{\"id\":\"u42\"}}");

            ConsumerRecord<String, byte[]> deadLetter =
                    awaitDlq(dlqConsumer, ingestor, dispatcher);

            System.out.println(timeline.stream()
                    .map(event -> event.name() + "=" + event.epochMillis())
                    .collect(java.util.stream.Collectors.joining("\n")));
            assertThat(attempts).hasSize(4);
            System.out.println("retry_intervals_ms=" + java.util.stream.IntStream.range(1, 4)
                    .mapToLong(i -> Duration.between(attempts.get(i - 1), attempts.get(i)).toMillis())
                    .boxed().toList());
            System.out.println("diagnostic_response_completion_to_next_arrival_ms="
                    + java.util.stream.IntStream.range(0, 3)
                            .mapToLong(i -> Duration.between(completions.get(i), attempts.get(i + 1)).toMillis())
                            .boxed().toList());
            assertThat(bodies).allMatch(body -> body.contains("\"uid\":\"u42\""));
            assertThat(traces).containsOnly("00-e2e-trace");
            assertThat(Duration.between(attempts.get(0), attempts.get(1)).toMillis())
                    .isGreaterThanOrEqualTo(150L).isLessThan(180L);
            assertThat(Duration.between(attempts.get(1), attempts.get(2)).toMillis())
                    .isGreaterThanOrEqualTo(300L).isLessThan(360L);
            assertThat(Duration.between(attempts.get(2), attempts.get(3)).toMillis())
                    .isGreaterThanOrEqualTo(600L).isLessThan(720L);
            assertThat(deadLetter.key()).isEqualTo("order-42");
            assertThat(new String(deadLetter.value(), StandardCharsets.UTF_8))
                    .isEqualTo("{\"id\":42,\"user\":{\"id\":\"u42\"}}");
            assertThat(header(deadLetter, "x-ojbk-dlq-reason"))
                    .isEqualTo("RETRY_EXHAUSTED");
            assertThat(header(deadLetter, "x-ojbk-origin-topic")).isEqualTo(source);
        } finally {
            endpoint.stop(0);
            endpointExecutor.close();
        }
    }

    private record TimingEvent(String name, long epochMillis) {}

    private static dev.ojbk.scheduler.DelayRepository observed(
            dev.ojbk.scheduler.DelayRepository repository, List<TimingEvent> timeline) {
        return new dev.ojbk.scheduler.DelayRepository() {
            @Override public void applyBatch(List<DelayCommand> commands) {
                timeline.add(new TimingEvent("ingest_started", Instant.now().toEpochMilli()));
                repository.applyBatch(commands);
                timeline.add(new TimingEvent("ingest_committed", Instant.now().toEpochMilli()));
            }
            @Override public int dispatchDue(Instant now, int limit, dev.ojbk.scheduler.DelaySender sender) {
                timeline.add(new TimingEvent("dispatch_tick", now.toEpochMilli()));
                return repository.dispatchDue(now, limit, sender);
            }
            @Override public int cleanupTerminal(Instant before, int limit) {
                return repository.cleanupTerminal(before, limit);
            }
            @Override public long pendingCount() { return repository.pendingCount(); }
            @Override public boolean awaitChange(Duration timeout) throws InterruptedException {
                return repository.awaitChange(timeout);
            }
            @Override public java.util.Optional<Instant> nextDueAt() {
                var due = repository.nextDueAt();
                timeline.add(new TimingEvent("deadline_query_finished", Instant.now().toEpochMilli()));
                timeline.add(new TimingEvent("deadline_query_result", due.map(Instant::toEpochMilli).orElse(-1L)));
                return due;
            }
        };
    }

    private static PushHttpClient diagnosticHttp(List<TimingEvent> timeline, List<Instant> completions) {
        JdkPushHttpClient client = new JdkPushHttpClient();
        return request -> {
            PushHttpResult result = client.deliver(request);
            Instant completed = Instant.now();
            completions.add(completed);
            timeline.add(new TimingEvent("http_result_received", completed.toEpochMilli()));
            return result;
        };
    }

    private static ConsumerRecord<String, byte[]> awaitDlq(
            KafkaConsumer<String, byte[]> dlq,
            KafkaDelayIngestor ingestor,
            DelayDispatcher dispatcher)
            throws InterruptedException {
        AtomicBoolean running = new AtomicBoolean(true);
        AtomicReference<RuntimeException> failure = new AtomicReference<>();
        Thread ingestThread = Thread.ofVirtual().start(() -> {
            while (running.get()) {
                try {
                    ingestor.pollOnce(Duration.ofMillis(10));
                } catch (RuntimeException error) {
                    failure.compareAndSet(null, error);
                    running.set(false);
                }
            }
        });
        Thread dispatchThread = Thread.ofVirtual().start(() -> {
            while (running.get()) {
                try {
                    dispatcher.tick(Instant.now());
                    dispatcher.awaitNextTick(Clock.systemUTC(), Duration.ofMillis(100));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    running.set(false);
                } catch (RuntimeException error) {
                    failure.compareAndSet(null, error);
                    running.set(false);
                }
            }
        });
        try {
            long deadline = System.nanoTime() + Duration.ofSeconds(60).toNanos();
            while (System.nanoTime() < deadline && failure.get() == null) {
                var records = dlq.poll(Duration.ofMillis(10));
                if (!records.isEmpty()) {
                    return records.iterator().next();
                }
            }
            if (failure.get() != null) {
                throw failure.get();
            }
            throw new AssertionError("DLQ record was not observed before timeout");
        } finally {
            running.set(false);
            ingestThread.join(Duration.ofSeconds(2));
            dispatchThread.join(Duration.ofSeconds(2));
        }
    }

    private static SubscriptionConfig subscription(
            String topic, String group, int endpointPort) {
        return new SubscriptionConfig(
                1,
                group,
                topic,
                "alice",
                true,
                Map.ofEntries(
                        Map.entry("mode", "PUSH"),
                        Map.entry("concurrency", 4),
                        Map.entry("maxTps", 1_000),
                        Map.entry("ordered", false),
                        Map.entry("dlqEnabled", true),
                        Map.entry("transit", Map.of("$.uid", "$.user.id")),
                        Map.entry(
                                "push",
                                Map.of(
                                        "urls",
                                                List.of("http://127.0.0.1:"
                                                        + endpointPort
                                                        + "/push"),
                                        "method", "POST",
                                        "timeoutMs", 2_000,
                                        "retryIntervalsMs", List.of(150, 300, 600)))));
    }

    private static NewTopic topic(String name, int partitions, int maxBytes) {
        return new NewTopic(name, partitions, (short) 1)
                .configs(Map.of("max.message.bytes", Integer.toString(maxBytes)));
    }

    private static void createTopics(List<NewTopic> topics) throws Exception {
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(topics).all().get(10, TimeUnit.SECONDS);
        }
    }

    private static KafkaConsumer<String, byte[]> consumer(String topic) {
        Properties properties = new Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, "dlq-" + UUID.randomUUID());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        KafkaConsumer<String, byte[]> consumer = new KafkaConsumer<>(properties);
        consumer.subscribe(List.of(topic));
        return consumer;
    }

    private static void publish(String topic, String key, String value) throws Exception {
        Properties properties = new Properties();
        properties.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        properties.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, ByteArraySerializer.class);
        try (KafkaProducer<byte[], byte[]> producer = new KafkaProducer<>(properties)) {
            RecordHeaders headers = new RecordHeaders();
            headers.add(
                    "traceparent",
                    "00-e2e-trace".getBytes(StandardCharsets.UTF_8));
            producer.send(new ProducerRecord<>(
                            topic,
                            null,
                            null,
                            key.getBytes(StandardCharsets.UTF_8),
                            value.getBytes(StandardCharsets.UTF_8),
                            headers))
                    .get(10, TimeUnit.SECONDS);
        }
    }

    private static String header(ConsumerRecord<String, byte[]> record, String name) {
        return new String(
                record.headers().lastHeader(name).value(), StandardCharsets.UTF_8);
    }
}
