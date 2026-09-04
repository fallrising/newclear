package dev.ojbk.console.group;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.audit.OperationAudit;
import dev.ojbk.console.configuration.OutboxPublisher;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import dev.ojbk.console.subscription.SubscriptionService;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
final class GroupWorkflowService {
    private static final Duration QUIET_TIMEOUT = Duration.ofSeconds(60);

    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final GroupOperations groups;
    private final SubscriptionService subscriptions;
    private final OutboxPublisher outbox;
    private final OperationAudit audit;
    private final ObjectMapper objectMapper = new ObjectMapper();

    GroupWorkflowService(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            GroupOperations groups,
            SubscriptionService subscriptions,
            ObjectProvider<OutboxPublisher> outbox,
            OperationAudit audit) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.groups = groups;
        this.subscriptions = subscriptions;
        this.outbox = outbox.getIfAvailable();
        this.audit = audit;
    }

    List<GroupTopicProgress> progress(long groupId, Actor actor) {
        List<SubscriptionRef> refs = subscriptions(groupId, null, actor);
        return refs.stream()
                .map(ref -> ref.classic()
                        ? new GroupTopicProgress(
                                ref.topic(),
                                "CLASSIC",
                                "",
                                groups.classicProgress(
                                        ref.group(),
                                        ref.topic(),
                                        ref.partitions()))
                        : GroupTopicProgress.unsupported(ref.topic()))
                .toList();
    }

    GroupOffsetReset reset(
            long groupId, ResetOffsetRequest request, Actor actor) {
        String mode = request.mode() == null
                ? ""
                : request.mode().toUpperCase(java.util.Locale.ROOT);
        if (!List.of("TIMESTAMP", "OFFSET").contains(mode)) {
            throw new IllegalArgumentException(
                    "reset mode must be TIMESTAMP or OFFSET");
        }
        SubscriptionRef ref = subscriptions(
                        groupId, request.topicId(), actor)
                .stream()
                .findFirst()
                .orElseThrow();
        if (!ref.classic()) {
            throw new ApiException(
                    "UNSUPPORTED",
                    HttpStatus.UNPROCESSABLE_CONTENT,
                    "Share Group offsets cannot be reset through the classic API");
        }

        boolean resume = ref.state() == 1;
        if (resume) {
            subscriptions.changeState(ref.subscriptionId(), false, actor);
            publishConfiguration(ref.subscriptionId());
        }
        try {
            if (!groups.awaitEmpty(ref.group(), QUIET_TIMEOUT)) {
                throw new ApiException(
                        "GROUP_NOT_QUIET",
                        HttpStatus.CONFLICT,
                        "consumer group did not become empty before timeout");
            }
            GroupOffsetReset result = groups.reset(
                    ref.group(),
                    ref.topic(),
                    ref.partitions(),
                    mode,
                    request.value());
            audit.record(
                    actor.username(),
                    "GROUP_OFFSET_RESET",
                    "GROUP",
                    ref.group(),
                    Map.of(
                            "topic", ref.topic(),
                            "mode", mode,
                            "value", request.value(),
                            "partitions", result.offsets().size()));
            return result;
        } finally {
            if (resume) {
                subscriptions.changeState(
                        ref.subscriptionId(), true, actor);
                publishConfiguration(ref.subscriptionId());
            }
        }
    }

    private List<SubscriptionRef> subscriptions(
            long groupId, Long topicId, Actor actor) {
        List<SubscriptionRef> refs = jdbc.sql("""
                        SELECT s.id AS subscription_id, s.state, s.spec::text,
                               s.owner AS subscription_owner,
                               g.name AS group_name, g.owner AS group_owner,
                               t.id AS topic_id, t.name AS topic_name,
                               t.owner AS topic_owner, t.partitions
                        FROM subscription s
                        JOIN consume_group g ON g.id = s.group_id
                        JOIN topic t ON t.id = s.topic_id
                        WHERE s.group_id = :groupId
                          AND s.state <> 9
                          AND g.state <> 9
                          AND t.state <> 9
                          AND (:topicId IS NULL OR t.id = :topicId)
                        ORDER BY t.id
                        """)
                .param("groupId", groupId)
                .param("topicId", topicId, java.sql.Types.BIGINT)
                .query((row, number) -> {
                    Map<String, Object> spec = decode(
                            row.getString("spec"));
                    return new SubscriptionRef(
                            row.getLong("subscription_id"),
                            row.getShort("state"),
                            row.getString("group_name"),
                            row.getString("group_owner"),
                            row.getLong("topic_id"),
                            row.getString("topic_name"),
                            row.getString("topic_owner"),
                            row.getString("subscription_owner"),
                            row.getInt("partitions"),
                            spec);
                })
                .list();
        if (refs.isEmpty()) {
            throw new ApiException(
                    "NOT_FOUND",
                    HttpStatus.NOT_FOUND,
                    "group subscription does not exist");
        }
        SubscriptionRef first = refs.getFirst();
        authorization.requireOwnerOrAdmin(first.groupOwner(), actor);
        refs.forEach(ref -> {
            authorization.requireOwnerOrAdmin(ref.topicOwner(), actor);
            authorization.requireOwnerOrAdmin(
                    ref.subscriptionOwner(), actor);
        });
        return refs;
    }

    private void publishConfiguration(long subscriptionId) {
        if (outbox == null) {
            return;
        }
        outbox.publishPending();
        long pending = jdbc.sql("""
                        SELECT count(*)
                        FROM outbox_event
                        WHERE aggregate_type = 'SUBSCRIPTION'
                          AND aggregate_id = :id
                          AND published_at IS NULL
                        """)
                .param("id", Long.toString(subscriptionId))
                .query(Long.class)
                .single();
        if (pending > 0) {
            throw new ApiException(
                    "CONFIG_PUBLICATION_FAILED",
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "subscription pause was not published");
        }
    }

    private Map<String, Object> decode(String json) {
        try {
            return objectMapper.readValue(json, new TypeReference<>() {});
        } catch (JsonProcessingException invalid) {
            throw new IllegalStateException(
                    "stored subscription spec cannot be decoded", invalid);
        }
    }

    private record SubscriptionRef(
            long subscriptionId,
            short state,
            String group,
            String groupOwner,
            long topicId,
            String topic,
            String topicOwner,
            String subscriptionOwner,
            int partitions,
            Map<String, Object> spec) {

        private boolean classic() {
            return "PUSH".equals(spec.get("mode"))
                    && Boolean.TRUE.equals(spec.get("ordered"));
        }
    }
}
