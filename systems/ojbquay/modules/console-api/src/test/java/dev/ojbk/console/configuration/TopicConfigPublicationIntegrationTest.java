package dev.ojbk.console.configuration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.KafkaConfigBusClient;
import dev.ojbk.delay.DelayCommand;
import dev.ojbk.console.group.GroupOperations;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.Admin;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.kafka.KafkaContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
final class TopicConfigPublicationIntegrationTest {
    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:17");

    @Container
    private static final KafkaContainer KAFKA = new KafkaContainer("apache/kafka:4.2.0");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("ojbquay.kafka.bootstrap-servers", KAFKA::getBootstrapServers);
        registry.add("ojbquay.bootstrap-admin.password", () -> "");
        registry.add("ojbquay.outbox.initial-delay", () -> "1h");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private OutboxPublisher outbox;

    @Autowired
    private Admin admin;

    @Autowired
    private GroupOperations groupOperations;

    @BeforeEach
    void cleanDatabase() {
        jdbc.sql("TRUNCATE audit_log, outbox_event, config_publish, subscription, "
                        + "consume_group, topic RESTART IDENTITY CASCADE")
                .update();
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void topicApiConvergesPostgresKafkaConfigBusAndAudit() throws Exception {
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "name": "orders",
                                  "clusterId": 1,
                                  "partitions": 3,
                                  "replication": 1,
                                  "delayTopic": false,
                                  "maxMessageBytes": 1048576,
                                  "retentionMs": 259200000,
                                  "produceQuotaTps": 1000,
                                  "compression": "zstd",
                                  "remark": "integration"
                                }
                                """))
                .andExpect(status().isCreated());

        assertThat(outbox.publishPending()).isEqualTo(1);

        ConfigStore store = new ConfigStore();
        try (KafkaConfigBusClient client = new KafkaConfigBusClient(
                KAFKA.getBootstrapServers(), "console-e2e", "instance-1", store)) {
            client.start();
            await(Duration.ofSeconds(10), client::ready);
            ConfigEvent event =
                    store.get(ConfigEntityType.TOPIC, "orders").orElseThrow();
            assertThat(event.version()).isEqualTo(1);
            assertThat(event.payload()).containsEntry("owner", "alice");

            assertThat(admin.listTopics().names().get(10, TimeUnit.SECONDS))
                    .contains("orders", "__ojbk.config", DelayCommand.INBOX_TOPIC);

            mockMvc.perform(delete("/api/v1/topics/1").with(csrf()))
                    .andExpect(status().isOk());
            assertThat(outbox.publishPending()).isEqualTo(1);
            await(Duration.ofSeconds(10), () -> store.topic("orders").isEmpty());
        }

        assertThat(admin.listTopics().names().get(10, TimeUnit.SECONDS))
                .contains("__ojbk.config", DelayCommand.INBOX_TOPIC)
                .doesNotContain("orders");
        assertThat(count("topic")).isEqualTo(1);
        assertThat(count("audit_log")).isEqualTo(2);
        assertThat(count("config_publish")).isEqualTo(2);
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM config_publish
                                WHERE payload IS NULL
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM outbox_event
                                WHERE published_at IS NOT NULL
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(2);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void testMessageSamplingAndClassicOffsetOperationsUseRealKafka()
            throws Exception {
        String suffix = java.util.UUID.randomUUID()
                .toString()
                .substring(0, 8);
        String topic = "sample-" + suffix;
        String group = "sample-group-" + suffix;
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "name": "%s",
                                  "clusterId": 1,
                                  "partitions": 1,
                                  "replication": 1,
                                  "delayTopic": false,
                                  "maxMessageBytes": 1048576,
                                  "retentionMs": 259200000,
                                  "produceQuotaTps": 1000,
                                  "compression": "zstd",
                                  "remark": "sample integration"
                                }
                                """.formatted(topic)))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/topics/1/test-message")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "key":"order-1",
                                  "valueBase64":"eyJhbW91bnQiOjF9",
                                  "tags":["paid"],
                                  "headers":{},
                                  "partition":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(org.springframework.test.web.servlet.result
                        .MockMvcResultMatchers.jsonPath("$.data.offset")
                        .value(0));
        await(Duration.ofSeconds(5), () -> {
            try {
                mockMvc.perform(org.springframework.test.web.servlet.request
                                .MockMvcRequestBuilders.get(
                                        "/api/v1/topics/1/sample")
                                .param("n", "10")
                                .param("cel", "body.amount == 1"))
                        .andExpect(status().isOk())
                        .andExpect(org.springframework.test.web.servlet.result
                                .MockMvcResultMatchers.jsonPath(
                                        "$.data[0].valueBase64")
                                .value("eyJhbW91bnQiOjF9"))
                        .andExpect(org.springframework.test.web.servlet.result
                                .MockMvcResultMatchers.jsonPath(
                                        "$.data[0].celMatched")
                                .value(true));
                return true;
            } catch (AssertionError transientEvaluationTimeout) {
                return false;
            }
        });

        assertThat(groupOperations.awaitEmpty(
                        group, Duration.ofSeconds(5)))
                .isTrue();
        assertThat(groupOperations.reset(
                                group, topic, 1, "OFFSET", 0)
                        .offsets())
                .containsExactly(
                        new dev.ojbk.console.group.PartitionOffset(0, 0));
        assertThat(groupOperations.classicProgress(group, topic, 1)
                        .getFirst()
                        .lag())
                .isEqualTo(1);
    }

    private long count(String table) {
        return jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single();
    }

    private static void await(Duration timeout, Condition condition) throws Exception {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (!condition.evaluate() && System.nanoTime() < deadline) {
            Thread.sleep(25);
        }
        assertThat(condition.evaluate()).isTrue();
    }

    @FunctionalInterface
    private interface Condition {
        boolean evaluate() throws Exception;
    }
}
