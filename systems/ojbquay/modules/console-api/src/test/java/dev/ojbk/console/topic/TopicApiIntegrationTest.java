package dev.ojbk.console.topic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.ojbk.console.cluster.ClusterHealth;
import dev.ojbk.console.cluster.ClusterOperations;
import dev.ojbk.console.delay.DelayCancellationPublisher;
import dev.ojbk.console.group.GroupOffsetReset;
import dev.ojbk.console.group.GroupOperations;
import dev.ojbk.console.group.PartitionOffset;
import dev.ojbk.console.kafka.KafkaAdminOperations;
import dev.ojbk.delay.DelayCommand;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.mock.web.MockHttpSession;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers
final class TopicApiIntegrationTest {
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

    @Autowired
    private PasswordEncoder passwordEncoder;

    @MockitoBean
    private KafkaAdminOperations kafkaAdmin;

    @MockitoBean
    private TopicMessageOperations topicMessages;

    @MockitoBean
    private DelayCancellationPublisher delayCancellationPublisher;

    @MockitoBean
    private GroupOperations groupOperations;

    @MockitoBean
    private ClusterOperations clusterOperations;

    @BeforeEach
    void cleanDatabase() {
        jdbc.sql("TRUNCATE audit_log, outbox_event, config_publish, subscription, "
                        + "consume_group, topic RESTART IDENTITY CASCADE")
                .update();
        jdbc.sql("DELETE FROM app_user").update();
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void createsTopicAuditAndOutboxAsOneObservableOperation() throws Exception {
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson()))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.code").value("OK"))
                .andExpect(jsonPath("$.data.name").value("orders"))
                .andExpect(jsonPath("$.data.owner").value("alice"))
                .andExpect(jsonPath("$.data.version").value(1));

        verify(kafkaAdmin).createTopic(any(), any());
        assertThat(count("topic")).isEqualTo(1);
        assertThat(count("audit_log")).isEqualTo(1);
        assertThat(count("config_publish")).isEqualTo(1);
        assertThat(count("outbox_event")).isEqualTo(1);
        assertThat(jdbc.sql("SELECT owner FROM topic WHERE name = 'orders'")
                        .query(String.class)
                        .single())
                .isEqualTo("alice");
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void samplesAndPublishesBoundedTestMessagesForAnOwnedTopic()
            throws Exception {
        createTopicAndGroup();
        when(topicMessages.sample("orders", 3, 10, false, "body.amount > 0"))
                .thenReturn(List.of(new TopicSample(
                        0,
                        42,
                        java.time.Instant.EPOCH,
                        "order-42",
                        "eyJhbW91bnQiOjF9",
                        List.of("paid"),
                        java.util.Map.of(),
                        false,
                        true)));
        when(topicMessages.publish(any(), any()))
                .thenReturn(new TestMessageResult("orders", 0, 43));

        mockMvc.perform(get("/api/v1/topics/{id}/sample", id("topic", "orders"))
                        .param("n", "10")
                        .param("cel", "body.amount > 0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].offset").value(42))
                .andExpect(jsonPath("$.data[0].celMatched").value(true));
        mockMvc.perform(post(
                                "/api/v1/topics/{id}/test-message",
                                id("topic", "orders"))
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "key":"order-43",
                                  "valueBase64":"eyJhbW91bnQiOjF9",
                                  "tags":["paid"],
                                  "headers":{"traceparent":"00-test"},
                                  "partition":0
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.offset").value(43));

        verify(topicMessages).sample(
                "orders", 3, 10, false, "body.amount > 0");
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM audit_log
                                WHERE action = 'TOPIC_TEST_MESSAGE'
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void queriesAndRequestsCancellationForAnOwnedPendingDelay()
            throws Exception {
        insertTopicOwnedBy("alice");
        jdbc.sql("""
                        INSERT INTO delay_message
                          (delay_id, target_topic, due_at, payload, status)
                        VALUES
                          ('delay-42', 'orders', now() + interval '1 hour',
                           '\\x01', 0)
                        """)
                .update();

        mockMvc.perform(get("/api/v1/delay/delay-42"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("PENDING"))
                .andExpect(jsonPath("$.data.payloadBytes").value(1));
        mockMvc.perform(post("/api/v1/delay/delay-42/cancel").with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cancelRequested").value(true));

        verify(delayCancellationPublisher)
                .publish(DelayCommand.cancel("delay-42", "orders"));
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM audit_log
                                WHERE action = 'DELAY_CANCEL_REQUESTED'
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void resetsClassicOffsetsOnlyAfterTheGroupIsQuietAndRestoresState()
            throws Exception {
        createTopicAndGroup();
        long topicId = id("topic", "orders");
        long groupId = id("consume_group", "settlement");
        jdbc.sql("""
                        INSERT INTO subscription
                          (group_id, topic_id, spec, owner)
                        VALUES
                          (:groupId, :topicId,
                           '{"mode":"PUSH","concurrency":4,"maxTps":100,
                             "ordered":true,"orderKeySource":"KEY",
                             "push":{"urls":["https://service.example/events"],
                             "method":"POST","timeoutMs":5000,
                             "retryIntervalsMs":[150]}}',
                           'alice')
                        """)
                .param("groupId", groupId)
                .param("topicId", topicId)
                .update();
        when(groupOperations.awaitEmpty(
                        "settlement", java.time.Duration.ofSeconds(60)))
                .thenReturn(false);

        mockMvc.perform(post("/api/v1/groups/{id}/reset-offset", groupId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"topicId":%d,"mode":"OFFSET","value":10}
                                """.formatted(topicId)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_QUIET"));

        verify(groupOperations, never())
                .reset("settlement", "orders", 3, "OFFSET", 10);
        assertThat(jdbc.sql("SELECT state FROM subscription")
                        .query(Integer.class)
                        .single())
                .isEqualTo(1);

        when(groupOperations.awaitEmpty(
                        "settlement", java.time.Duration.ofSeconds(60)))
                .thenReturn(true);
        when(groupOperations.reset(
                        "settlement", "orders", 3, "OFFSET", 10))
                .thenReturn(new GroupOffsetReset(
                        "settlement",
                        "orders",
                        List.of(
                                new PartitionOffset(0, 10),
                                new PartitionOffset(1, 10),
                                new PartitionOffset(2, 10))));

        mockMvc.perform(post("/api/v1/groups/{id}/reset-offset", groupId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"topicId":%d,"mode":"OFFSET","value":10}
                                """.formatted(topicId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.offsets[0].offset").value(10));
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM audit_log
                                WHERE action = 'GROUP_OFFSET_RESET'
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void rollsBackMetadataAndCompensatesBrokerWhenProvisioningFails() throws Exception {
        doThrow(new IllegalStateException("broker unavailable"))
                .when(kafkaAdmin)
                .createTopic(any(), any());

        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("BROKER_UNAVAILABLE"));

        assertThat(count("topic")).isZero();
        assertThat(count("audit_log")).isZero();
        assertThat(count("outbox_event")).isZero();
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void createsGroupAndValidatedSubscriptionWithVersionedChanges() throws Exception {
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson()))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/groups")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"name":"settlement","remark":"settlement consumers"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.owner").value("alice"));

        long topicId = id("topic", "orders");
        long groupId = id("consume_group", "settlement");
        mockMvc.perform(post("/api/v1/subscriptions")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "groupId": %d,
                                  "topicId": %d,
                                  "spec": {
                                    "mode": "PUSH",
                                    "filterCel": "body.amount > 10000",
                                    "concurrency": 8,
                                    "maxTps": 100,
                                    "push": {
                                      "urls": ["https://service.example/callback"],
                                      "method": "POST",
                                      "timeoutMs": 5000,
                                      "retryIntervalsMs": [150, 300, 600]
                                    },
                                    "dlqEnabled": true
                                  }
                                }
                                """.formatted(groupId, topicId)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.owner").value("alice"))
                .andExpect(jsonPath("$.data.version").value(1));

        assertThat(count("subscription")).isEqualTo(1);
        assertThat(count("config_publish")).isEqualTo(3);
        assertThat(count("outbox_event")).isEqualTo(3);
        assertThat(count("audit_log")).isEqualTo(3);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void rejectsInvalidSubscriptionExpressionBeforePersistence() throws Exception {
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson()))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/groups")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"name":"settlement","remark":""}
                                """))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/api/v1/subscriptions")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "groupId": %d,
                                  "topicId": %d,
                                  "spec": {
                                    "mode": "PUSH",
                                    "filterCel": "not valid CEL !",
                                    "concurrency": 8,
                                    "maxTps": 100,
                                    "push": {
                                      "urls": ["https://service.example/callback"],
                                      "method": "POST",
                                      "timeoutMs": 5000,
                                      "retryIntervalsMs": [150]
                                    }
                                  }
                                }
                                """.formatted(
                                        id("consume_group", "settlement"),
                                        id("topic", "orders"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));

        assertThat(count("subscription")).isZero();
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void provisionsPullWithoutRetryTopicAndRejectsConflictingGroupLease()
            throws Exception {
        createTopicAndGroup();
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson().replace("orders", "shipments")))
                .andExpect(status().isCreated());
        long groupId = id("consume_group", "settlement");

        mockMvc.perform(post("/api/v1/subscriptions")
                        .with(csrf())
                        .contentType("application/json")
                        .content(pullSubscriptionJson(
                                groupId, id("topic", "orders"), 15_000)))
                .andExpect(status().isCreated());

        verify(kafkaAdmin).configureShareGroup("settlement", 15_000);
        mockMvc.perform(post("/api/v1/subscriptions")
                        .with(csrf())
                        .contentType("application/json")
                        .content(pullSubscriptionJson(
                                groupId, id("topic", "shipments"), 30_000)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_ARGUMENT"));

        assertThat(count("subscription")).isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void updatesAndPausesOwnedResourcesWithMonotonicConfigVersions() throws Exception {
        createTopicAndGroup();
        long topicId = id("topic", "orders");
        long groupId = id("consume_group", "settlement");
        long subscriptionId = createPushSubscription(topicId, groupId);

        mockMvc.perform(put("/api/v1/topics/{id}", topicId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "maxMessageBytes": 2097152,
                                  "retentionMs": 604800000,
                                  "produceQuotaTps": 2000,
                                  "compression": "lz4",
                                  "remark": "updated policy"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(2))
                .andExpect(jsonPath("$.data.maxMessageBytes").value(2097152));

        mockMvc.perform(put("/api/v1/subscriptions/{id}", subscriptionId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "spec": {
                                    "mode": "PUSH",
                                    "filterCel": "body.amount >= 20000",
                                    "concurrency": 4,
                                    "maxTps": 50,
                                    "push": {
                                      "urls": ["https://service.example/v2/callback"],
                                      "method": "POST",
                                      "timeoutMs": 3000,
                                      "retryIntervalsMs": [200, 400]
                                    },
                                    "dlqEnabled": true
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.version").value(2));

        mockMvc.perform(post("/api/v1/subscriptions/{id}/state", subscriptionId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("{\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state").value(0))
                .andExpect(jsonPath("$.data.version").value(3));

        mockMvc.perform(get("/api/v1/topics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].name").value("orders"))
                .andExpect(jsonPath("$.data[0].version").value(2));
        mockMvc.perform(get("/api/v1/subscriptions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].id").value(subscriptionId))
                .andExpect(jsonPath("$.data[0].state").value(0));

        assertThat(count("config_publish")).isEqualTo(6);
        assertThat(count("outbox_event")).isEqualTo(6);
        assertThat(count("audit_log")).isEqualTo(6);
    }

    @Test
    @WithMockUser(username = "bob", roles = "USER")
    void deniesMutationAndHidesResourcesOwnedByAnotherUser() throws Exception {
        insertTopicOwnedBy("alice");
        long topicId = id("topic", "orders");

        mockMvc.perform(get("/api/v1/topics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
        mockMvc.perform(put("/api/v1/topics/{id}", topicId)
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "maxMessageBytes": 1048576,
                                  "retentionMs": 259200000,
                                  "produceQuotaTps": 500,
                                  "compression": "zstd",
                                  "remark": ""
                                }
                                """))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    @WithMockUser(username = "operator", roles = "OPS")
    void exposesOperatorSnapshotAndPaginatedAudit() throws Exception {
        insertTopicOwnedBy("alice");
        jdbc.sql("""
                        INSERT INTO audit_log (actor, action, entity, entity_id, detail)
                        VALUES ('alice', 'TOPIC_CREATED', 'TOPIC', 'orders', '{}')
                        """)
                .update();

        mockMvc.perform(get("/internal/v1/config/snapshot"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value("OK"))
                .andExpect(jsonPath("$.data.topics[0].name").value("orders"))
                .andExpect(jsonPath("$.data.groups.length()").value(0))
                .andExpect(jsonPath("$.data.subscriptions.length()").value(0));
        mockMvc.perform(get("/api/v1/audit").param("page", "0").param("size", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].action").value("TOPIC_CREATED"))
                .andExpect(jsonPath("$.data.total").value(1));
    }

    @Test
    @WithMockUser(username = "operator", roles = "OPS")
    void exposesDefaultClusterHealthToOperators() throws Exception {
        when(clusterOperations.health())
                .thenReturn(new ClusterHealth("test-cluster", 1, 3, "UP"));

        mockMvc.perform(get("/api/v1/clusters"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].name").value("local"))
                .andExpect(jsonPath("$.data[0].defaultCluster").value(true));
        mockMvc.perform(get("/api/v1/clusters/1/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.clusterId").value("test-cluster"))
                .andExpect(jsonPath("$.data.nodeCount").value(3))
                .andExpect(jsonPath("$.data.status").value("UP"));
    }

    @Test
    @WithMockUser(username = "admin", roles = "ADMIN")
    void createsAndAuditsUsersWithoutReturningCredentials() throws Exception {
        mockMvc.perform(post("/api/v1/admin/users")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "username":"release-operator",
                                  "password":"correct-horse-battery",
                                  "role":"OPS"
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.data.username").value("release-operator"))
                .andExpect(jsonPath("$.data.role").value("OPS"))
                .andExpect(jsonPath("$.data.password").doesNotExist())
                .andExpect(jsonPath("$.data.passwordHash").doesNotExist());

        String hash = jdbc.sql("""
                        SELECT password_hash FROM app_user
                        WHERE username = 'release-operator'
                        """)
                .query(String.class)
                .single();
        assertThat(hash).startsWith("$2");
        assertThat(hash).doesNotContain("correct-horse-battery");
        assertThat(jdbc.sql("""
                                SELECT count(*) FROM audit_log
                                WHERE action = 'USER_CREATED'
                                  AND actor = 'admin'
                                  AND detail->>'role' = 'OPS'
                                """)
                        .query(Long.class)
                        .single())
                .isEqualTo(1);
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void deniesAdministrativeOperationsToResourceOwners() throws Exception {
        mockMvc.perform(get("/api/v1/clusters"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(get("/api/v1/admin/users"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void rejectsSnapshotAndAuditForNonOperators() throws Exception {
        mockMvc.perform(get("/internal/v1/config/snapshot"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
        mockMvc.perform(get("/api/v1/audit"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("FORBIDDEN"));
    }

    @Test
    void authenticatesAStoredUserAndPersistsTheSession() throws Exception {
        jdbc.sql("""
                        INSERT INTO app_user (username, password_hash, role)
                        VALUES ('alice', :password, 'USER')
                        """)
                .param("password", passwordEncoder.encode("correct-horse"))
                .update();

        MvcResult login = mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"username":"alice","password":"correct-horse"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("alice"))
                .andExpect(jsonPath("$.data.roles[0]").value("USER"))
                .andReturn();

        mockMvc.perform(get("/api/v1/auth/me")
                        .session((MockHttpSession) login.getRequest().getSession()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.username").value("alice"));
    }

    @Test
    void returnsStableUnauthorizedResponseForBadCredentials() throws Exception {
        jdbc.sql("""
                        INSERT INTO app_user (username, password_hash, role)
                        VALUES ('alice', :password, 'USER')
                        """)
                .param("password", passwordEncoder.encode("correct-horse"))
                .update();

        mockMvc.perform(post("/api/v1/auth/login")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {"username":"alice","password":"wrong"}
                                """))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    @Test
    void bootstrapsCsrfWithoutAnAuthenticatedSession() throws Exception {
        mockMvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.headerName").isNotEmpty())
                .andExpect(jsonPath("$.data.token").isNotEmpty());
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void generatesOpenApiForTheControlPlaneContract() throws Exception {
        mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.paths['/api/v1/topics']").exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/topics/{id}/sample']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/topics/{id}/test-message']")
                        .exists())
                .andExpect(jsonPath("$.paths['/api/v1/subscriptions']").exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/subscriptions/preview']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/groups/{id}/progress']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/groups/{id}/reset-offset']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/delay/{delayId}']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/subscriptions/{subscriptionId}/dlq']")
                        .exists())
                .andExpect(jsonPath(
                                "$.paths['/api/v1/subscriptions/{subscriptionId}/dlq/replay']")
                        .exists());
    }

    @Test
    @WithMockUser(username = "alice", roles = "USER")
    void softDeletesSubscriptionGroupAndTopicWithoutOrphaningReferences() throws Exception {
        createTopicAndGroup();
        long topicId = id("topic", "orders");
        long groupId = id("consume_group", "settlement");
        long subscriptionId = createPushSubscription(topicId, groupId);

        mockMvc.perform(delete("/api/v1/topics/{id}", topicId).with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RESOURCE_IN_USE"));

        mockMvc.perform(delete("/api/v1/subscriptions/{id}", subscriptionId).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state").value(9));
        mockMvc.perform(delete("/api/v1/groups/{id}", groupId).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state").value(9));
        mockMvc.perform(delete("/api/v1/topics/{id}", topicId).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state").value(9));

        mockMvc.perform(get("/api/v1/topics"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
        mockMvc.perform(get("/api/v1/groups"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
        mockMvc.perform(get("/api/v1/subscriptions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));

        assertThat(count("config_publish")).isEqualTo(6);
        assertThat(count("audit_log")).isEqualTo(6);
    }

    private long count(String table) {
        return jdbc.sql("SELECT count(*) FROM " + table).query(Long.class).single();
    }

    private long id(String table, String name) {
        return jdbc.sql("SELECT id FROM " + table + " WHERE name = :name")
                .param("name", name)
                .query(Long.class)
                .single();
    }

    private void createTopicAndGroup() throws Exception {
        mockMvc.perform(post("/api/v1/topics")
                        .with(csrf())
                        .contentType("application/json")
                        .content(validTopicJson()))
                .andExpect(status().isCreated());
        mockMvc.perform(post("/api/v1/groups")
                        .with(csrf())
                        .contentType("application/json")
                        .content("{\"name\":\"settlement\",\"remark\":\"\"}"))
                .andExpect(status().isCreated());
    }

    private long createPushSubscription(long topicId, long groupId) throws Exception {
        mockMvc.perform(post("/api/v1/subscriptions")
                        .with(csrf())
                        .contentType("application/json")
                        .content("""
                                {
                                  "groupId": %d,
                                  "topicId": %d,
                                  "spec": {
                                    "mode": "PUSH",
                                    "filterCel": "body.amount > 10000",
                                    "concurrency": 8,
                                    "maxTps": 100,
                                    "push": {
                                      "urls": ["https://service.example/callback"],
                                      "method": "POST",
                                      "timeoutMs": 5000,
                                      "retryIntervalsMs": [150, 300]
                                    },
                                    "dlqEnabled": true
                                  }
                                }
                                """.formatted(groupId, topicId)))
                .andExpect(status().isCreated());
        return jdbc.sql("""
                        SELECT id FROM subscription
                        WHERE topic_id = :topicId AND group_id = :groupId
                        """)
                .param("topicId", topicId)
                .param("groupId", groupId)
                .query(Long.class)
                .single();
    }

    private void insertTopicOwnedBy(String owner) {
        jdbc.sql("""
                        INSERT INTO topic (
                          name, cluster_id, partitions, replication, delay_topic,
                          max_message_bytes, retention_ms, produce_quota_tps,
                          compression, token, owner, remark
                        )
                        VALUES (
                          'orders', 1, 3, 1, false,
                          1048576, 259200000, 1000,
                          'zstd', '0123456789abcdef0123456789abcdef', :owner, ''
                        )
                        """)
                .param("owner", owner)
                .update();
    }

    private static String validTopicJson() {
        return """
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
                  "remark": "orders lifecycle"
                }
                """;
    }

    private static String pullSubscriptionJson(
            long groupId, long topicId, int ackTimeoutMs) {
        return """
                {
                  "groupId": %d,
                  "topicId": %d,
                  "spec": {
                    "mode": "PULL",
                    "concurrency": 32,
                    "maxTps": 1000,
                    "ordered": false,
                    "pull": {
                      "maxBatch": 16,
                      "ackTimeoutMs": %d,
                      "maxRetry": 3
                    },
                    "dlqEnabled": true
                  }
                }
                """.formatted(groupId, topicId, ackTimeoutMs);
    }
}
