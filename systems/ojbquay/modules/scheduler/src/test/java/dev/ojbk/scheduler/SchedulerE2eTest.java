package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.delay.DelayCommand;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.gateway.produce.BrokerAck;
import dev.ojbk.gateway.produce.DelayGateway;
import dev.ojbk.gateway.produce.KafkaDelayCommandPublisher;
import dev.ojbk.gateway.produce.ProducerEngine;
import dev.ojbk.gateway.produce.ProducerGrpcService;
import dev.ojbk.gateway.produce.TokenMetadataInterceptor;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.sdk.OjbkMessage;
import dev.ojbk.sdk.OjbkProducer;
import dev.ojbk.sdk.DelaySchedule;
import io.grpc.Server;
import io.grpc.ServerInterceptors;
import io.grpc.netty.shaded.io.grpc.netty.NettyServerBuilder;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
final class SchedulerE2eTest {
    private static final String TARGET_TOPIC = "scheduled-orders";
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";

    @Container
    private static final KafkaContainer KAFKA =
            new KafkaContainer("apache/kafka:4.2.0");

    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:17");

    private static DataSource dataSource;

    @BeforeAll
    static void provision() throws Exception {
        PGSimpleDataSource postgres = new PGSimpleDataSource();
        postgres.setURL(POSTGRES.getJdbcUrl());
        postgres.setUser(POSTGRES.getUsername());
        postgres.setPassword(POSTGRES.getPassword());
        dataSource = postgres;
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
        try (Admin admin = Admin.create(
                Map.of("bootstrap.servers", KAFKA.getBootstrapServers()))) {
            admin.createTopics(List.of(
                            new NewTopic(DelayCommand.INBOX_TOPIC, 12, (short) 1)
                                    .configs(Map.of(
                                            "max.message.bytes",
                                            Integer.toString(
                                                    MessageLimits.MAX_DELAY_COMMAND_BYTES))),
                            new NewTopic(TARGET_TOPIC, 3, (short) 1)
                                    .configs(Map.of(
                                            "max.message.bytes",
                                            Integer.toString(
                                                    MessageLimits.kafkaRecordLimit(
                                                            MessageLimits.MAX_VALUE_BYTES))))))
                    .all()
                    .get(10, TimeUnit.SECONDS);
        }
    }

    @Test
    void ingestsCommittedCommandAndDispatchesKafkaRecordWithDelayIdentity()
            throws Exception {
        Instant due = Instant.now().plusSeconds(30);
        JdbcDelayRepository repository = new JdbcDelayRepository(dataSource);
        DelayRepository failOnce = new FailOnceRepository(repository);
        ExecutorService grpcExecutor = Executors.newVirtualThreadPerTaskExecutor();
        ConfigStore config = configuredTopic();
        try (KafkaDelayCommandPublisher publisher =
                        new KafkaDelayCommandPublisher(KAFKA.getBootstrapServers());
                KafkaDelayIngestor ingestor = new KafkaDelayIngestor(
                        KAFKA.getBootstrapServers(), "scheduler-e2e", failOnce);
                KafkaDelaySender sender = new KafkaDelaySender(KAFKA.getBootstrapServers());
                KafkaConsumer<String, byte[]> consumer = consumer()) {
            ProducerEngine engine = new ProducerEngine(
                    config,
                    ignored -> new BrokerAck(TARGET_TOPIC, 0, 0));
            Server server = NettyServerBuilder.forPort(0)
                    .maxInboundMessageSize(MessageLimits.MAX_KAFKA_REQUEST_BYTES)
                    .executor(grpcExecutor)
                    .addService(ServerInterceptors.intercept(
                            new ProducerGrpcService(
                                    engine,
                                    new DelayGateway(engine, publisher, Duration.ZERO)),
                            new TokenMetadataInterceptor()))
                    .build()
                    .start();
            try {
                try (OjbkProducer producer = OjbkProducer.forTarget(
                                "localhost:" + server.getPort(), TOKEN)
                        .plaintext()
                        .deadline(Duration.ofSeconds(5))
                        .build()) {
                    byte[] maximumValue = new byte[MessageLimits.MAX_VALUE_BYTES];
                    maximumValue[maximumValue.length - 1] = 42;
                    String delayId = producer.schedule(
                            new OjbkMessage(
                                    TARGET_TOPIC,
                                    "order-42",
                                    maximumValue,
                                    List.of("paid", "priority"),
                                    Map.of("traceparent", "00-e2e"),
                                    1),
                            new DelaySchedule("delay-e2e", due, null, null, null));
                    assertThat(delayId).isEqualTo("delay-e2e");
                }
                awaitExpectedIngestFailure(ingestor);
                awaitIngest(ingestor);
                consumer.subscribe(List.of(TARGET_TOPIC));

                int dispatched = new DelayDispatcher(repository, sender).tick(due);
                var record = awaitRecord(consumer);

                assertThat(dispatched).isEqualTo(1);
                assertThat(record.key()).isEqualTo("order-42");
                assertThat(record.partition()).isEqualTo(1);
                assertThat(record.value())
                        .hasSize(MessageLimits.MAX_VALUE_BYTES)
                        .endsWith(42);
                assertThat(header(record, "x-ojbk-delay-id")).isEqualTo("delay-e2e");
                assertThat(header(record, "x-ojbk-tags")).isEqualTo("paid,priority");
                assertThat(header(record, "traceparent")).isEqualTo("00-e2e");
                assertThat(status()).isEqualTo(DelayStatus.DONE);
            } finally {
                server.shutdownNow().awaitTermination(5, TimeUnit.SECONDS);
            }
        } finally {
            grpcExecutor.close();
        }
    }

    private static KafkaConsumer<String, byte[]> consumer() {
        java.util.Properties properties = new java.util.Properties();
        properties.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, KAFKA.getBootstrapServers());
        properties.put(ConsumerConfig.GROUP_ID_CONFIG, "scheduler-target-" + UUID.randomUUID());
        properties.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
        properties.put(ConsumerConfig.ENABLE_AUTO_COMMIT_CONFIG, false);
        properties.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        properties.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
        return new KafkaConsumer<>(properties);
    }

    private static void awaitIngest(KafkaDelayIngestor ingestor) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (ingestor.pollOnce(Duration.ofMillis(100)) == 1) {
                return;
            }
        }
        throw new AssertionError("delay command was not ingested before timeout");
    }

    private static void awaitExpectedIngestFailure(KafkaDelayIngestor ingestor) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            try {
                ingestor.pollOnce(Duration.ofMillis(100));
            } catch (IllegalStateException expected) {
                assertThat(expected).hasMessage("simulated database outage");
                return;
            }
        }
        throw new AssertionError("simulated ingestion failure was not observed before timeout");
    }

    private static org.apache.kafka.clients.consumer.ConsumerRecord<String, byte[]> awaitRecord(
            KafkaConsumer<String, byte[]> consumer) {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            var records = consumer.poll(Duration.ofMillis(100));
            if (!records.isEmpty()) {
                return records.iterator().next();
            }
        }
        throw new AssertionError("scheduled record was not observed before timeout");
    }

    private static String header(
            org.apache.kafka.clients.consumer.ConsumerRecord<String, byte[]> record,
            String name) {
        return new String(record.headers().lastHeader(name).value(), StandardCharsets.UTF_8);
    }

    private static DelayStatus status() throws Exception {
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery(
                        "SELECT status FROM delay_message WHERE delay_id = 'delay-e2e'")) {
            result.next();
            return DelayStatus.fromCode(result.getShort(1));
        }
    }

    private static ConfigStore configuredTopic() {
        ConfigStore store = new ConfigStore();
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                TARGET_TOPIC,
                1,
                Instant.now(),
                "e2e",
                Map.ofEntries(
                        Map.entry("name", TARGET_TOPIC),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", true),
                        Map.entry("maxMessageBytes", MessageLimits.MAX_VALUE_BYTES),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 1_000),
                        Map.entry("token", TOKEN),
                        Map.entry("owner", "alice"),
                        Map.entry("enabled", true))));
        return store;
    }

    private static final class FailOnceRepository implements DelayRepository {
        private final DelayRepository delegate;
        private final AtomicBoolean first = new AtomicBoolean(true);

        private FailOnceRepository(DelayRepository delegate) {
            this.delegate = delegate;
        }

        @Override
        public void applyBatch(List<dev.ojbk.delay.DelayCommand> commands) {
            if (first.compareAndSet(true, false)) {
                throw new IllegalStateException("simulated database outage");
            }
            delegate.applyBatch(commands);
        }

        @Override
        public int dispatchDue(Instant now, int limit, DelaySender sender) {
            return delegate.dispatchDue(now, limit, sender);
        }

        @Override
        public int cleanupTerminal(Instant before, int limit) {
            return delegate.cleanupTerminal(before, limit);
        }

        @Override
        public long pendingCount() {
            return delegate.pendingCount();
        }
    }
}
