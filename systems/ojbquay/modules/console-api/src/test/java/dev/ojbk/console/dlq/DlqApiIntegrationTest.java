package dev.ojbk.console.dlq;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.ojbk.console.kafka.KafkaAdminOperations;
import dev.ojbk.console.kafka.KafkaDlqOperations;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
final class DlqApiIntegrationTest {
    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer("postgres:17");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("ojbquay.bootstrap-admin.password", () -> "");
        registry.add("ojbquay.outbox.enabled", () -> "false");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbc;

    @MockitoBean
    private KafkaAdminOperations kafkaAdmin;

    @MockitoBean
    private KafkaDlqOperations kafkaDlq;

    @BeforeEach
    void prepareSubscription() {
        jdbc.sql("TRUNCATE audit_log, outbox_event, config_publish, subscription, "
                        + "consume_group, topic RESTART IDENTITY CASCADE")
                .update();
        jdbc.sql("""
                        INSERT INTO topic (
                          name, cluster_id, partitions, replication, delay_topic,
                          max_message_bytes, retention_ms, produce_quota_tps,
                          compression, token, owner, remark
                        )
                        VALUES (
                          'orders', 1, 3, 1, false, 1048576, 259200000, 1000,
                          'zstd', '0123456789abcdef0123456789abcdef', 'alice', ''
                        )
                        """)
                .update();
        jdbc.sql("""
                        INSERT INTO consume_group (name, token, owner, remark)
                        VALUES (
                          'settlement', 'abcdef0123456789abcdef0123456789', 'alice', ''
                        )
                        """)
                .update();
        jdbc.sql("""
                        INSERT INTO subscription (group_id, topic_id, spec, owner)
                        VALUES (
                          1, 1,
                          '{"mode":"PUSH","concurrency":2,"maxTps":100,
                            "dlqEnabled":true,"ordered":false,
                            "push":{"urls":["https://example.test"],"method":"POST",
                            "timeoutMs":1000,"retryIntervalsMs":[150]}}',
                          'alice'
                        )
                        """)
                .update();
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void ownerBrowsesAndReplaysBoundedOffsetsWithAudit() throws Exception {
        when(kafkaDlq.readTail("orders.settlement.dlq", 25))
                .thenReturn(List.of(new DlqRecordView(
                        0,
                        7,
                        Instant.EPOCH,
                        "order-42",
                        "e30=",
                        Map.of("x-ojbk-retry", "3"))));

        mockMvc.perform(get("/api/v1/subscriptions/1/dlq").param("n", "25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].partition").value(0))
                .andExpect(jsonPath("$.data[0].offset").value(7))
                .andExpect(jsonPath("$.data[0].key").value("order-42"));

        mockMvc.perform(post("/api/v1/subscriptions/1/dlq/replay")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"records":[{"partition":0,"offset":7}]}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.replayed").value(1));

        verify(kafkaDlq).replay(
                "orders.settlement.dlq",
                "orders",
                List.of(new DlqRecordRef(0, 7)));
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM audit_log
                                WHERE action = 'DLQ_REPLAYED'
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "bob", roles = "USER")
    void nonOwnerCannotBrowseDlq() throws Exception {
        mockMvc.perform(get("/api/v1/subscriptions/1/dlq"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }
}
