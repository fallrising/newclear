package dev.ojbk.console.subscription;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.PullSubscriptionSpec;
import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.configuration.ChangeRecorder;
import dev.ojbk.console.kafka.KafkaAdminOperations;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SubscriptionService {
    private static final long RETRY_RETENTION_MS = 7L * 24 * 60 * 60 * 1_000;
    private static final long DLQ_RETENTION_MS = 30L * 24 * 60 * 60 * 1_000;

    private final JdbcClient jdbc;
    private final SubscriptionValidator validator;
    private final ResourceAuthorization authorization;
    private final KafkaAdminOperations kafka;
    private final ChangeRecorder changes;
    private final ObjectMapper objectMapper = new ObjectMapper();

    SubscriptionService(
            JdbcClient jdbc,
            SubscriptionValidator validator,
            ResourceAuthorization authorization,
            KafkaAdminOperations kafka,
            ChangeRecorder changes) {
        this.jdbc = jdbc;
        this.validator = validator;
        this.authorization = authorization;
        this.kafka = kafka;
        this.changes = changes;
    }

    @Transactional
    public SubscriptionView create(CreateSubscriptionRequest request, Actor actor) {
        validator.validate(request.spec());
        ResourceRef group = group(request.groupId());
        ResourceRef topic = topic(request.topicId());
        authorization.requireOwnerOrAdmin(group.owner(), actor);
        authorization.requireOwnerOrAdmin(topic.owner(), actor);
        requireCompatibleShareLock(group.id(), request.spec(), null);

        String specJson = json(request.spec());
        SubscriptionView subscription = jdbc.sql("""
                        INSERT INTO subscription (group_id, topic_id, spec, owner)
                        VALUES (:groupId, :topicId, CAST(:spec AS jsonb), :owner)
                        RETURNING *
                        """)
                .param("groupId", group.id())
                .param("topicId", topic.id())
                .param("spec", specJson)
                .param("owner", actor.username())
                .query(SubscriptionService::map)
                .single();

        List<String> createdTopics = new ArrayList<>();
        try {
            Integer shareLock = shareLockDuration(request.spec());
            if (shareLock != null) {
                kafka.configureShareGroup(group.name(), shareLock);
            }
            if ("PUSH".equals(request.spec().get("mode"))) {
                String retryTopic = topic.name() + "." + group.name() + ".retry";
                kafka.createInternalTopic(
                        retryTopic, topic.partitions(), RETRY_RETENTION_MS);
                createdTopics.add(retryTopic);
            }
            if (Boolean.TRUE.equals(request.spec().get("dlqEnabled"))) {
                String dlqTopic = topic.name() + "." + group.name() + ".dlq";
                kafka.createInternalTopic(dlqTopic, topic.partitions(), DLQ_RETENTION_MS);
                createdTopics.add(dlqTopic);
            }
            changes.record(
                    ConfigEntityType.SUBSCRIPTION,
                    Long.toString(subscription.id()),
                    subscription.version(),
                    actor.username(),
                    "SUBSCRIPTION_CREATED",
                    payload(subscription, group.name(), topic.name()));
            return subscription;
        } catch (RuntimeException failure) {
            for (String createdTopic : createdTopics) {
                try {
                    kafka.deleteTopic(createdTopic);
                } catch (RuntimeException compensationFailure) {
                    failure.addSuppressed(compensationFailure);
                }
            }
            throw failure;
        }
    }

    public List<SubscriptionView> list(Actor actor) {
        if (actor.isAdmin() || actor.isOps()) {
            return jdbc.sql("SELECT * FROM subscription WHERE state <> 9 ORDER BY id")
                    .query(SubscriptionService::map)
                    .list();
        }
        return jdbc.sql("""
                        SELECT * FROM subscription
                        WHERE state <> 9 AND owner = :owner
                        ORDER BY id
                        """)
                .param("owner", actor.username())
                .query(SubscriptionService::map)
                .list();
    }

    @Transactional
    public SubscriptionView update(
            long id, UpdateSubscriptionRequest request, Actor actor) {
        SubscriptionView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        validator.validate(request.spec());
        requireCompatibleShareLock(
                current.groupId(), request.spec(), current.id());
        SubscriptionView updated = jdbc.sql("""
                        UPDATE subscription
                        SET spec = CAST(:spec AS jsonb),
                            version = version + 1,
                            updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("spec", json(request.spec()))
                .param("id", id)
                .param("version", current.version())
                .query(SubscriptionService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "subscription changed concurrently"));
        ResourceRef group = group(updated.groupId());
        ResourceRef topic = topic(updated.topicId());
        Integer shareLock = shareLockDuration(updated.spec());
        if (shareLock != null) {
            kafka.configureShareGroup(group.name(), shareLock);
        }
        changes.record(
                ConfigEntityType.SUBSCRIPTION,
                Long.toString(updated.id()),
                updated.version(),
                actor.username(),
                "SUBSCRIPTION_UPDATED",
                payload(updated, group.name(), topic.name()));
        return updated;
    }

    @Transactional
    public SubscriptionView changeState(long id, boolean enabled, Actor actor) {
        SubscriptionView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        short state = enabled ? (short) 1 : (short) 0;
        if (current.state() == state) {
            return current;
        }
        SubscriptionView updated = jdbc.sql("""
                        UPDATE subscription
                        SET state = :state, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("state", state)
                .param("id", id)
                .param("version", current.version())
                .query(SubscriptionService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "subscription changed concurrently"));
        ResourceRef group = group(updated.groupId());
        ResourceRef topic = topic(updated.topicId());
        changes.record(
                ConfigEntityType.SUBSCRIPTION,
                Long.toString(updated.id()),
                updated.version(),
                actor.username(),
                enabled ? "SUBSCRIPTION_ENABLED" : "SUBSCRIPTION_DISABLED",
                payload(updated, group.name(), topic.name()));
        return updated;
    }

    @Transactional
    public SubscriptionView delete(long id, Actor actor) {
        SubscriptionView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        ResourceRef group = group(current.groupId());
        ResourceRef topic = topic(current.topicId());
        SubscriptionView deleted = jdbc.sql("""
                        UPDATE subscription
                        SET state = 9, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("id", id)
                .param("version", current.version())
                .query(SubscriptionService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "subscription changed concurrently"));
        changes.recordDelete(
                ConfigEntityType.SUBSCRIPTION,
                Long.toString(deleted.id()),
                deleted.version(),
                actor.username(),
                "SUBSCRIPTION_DELETED",
                payload(deleted, group.name(), topic.name()));
        if ("PUSH".equals(deleted.spec().get("mode"))) {
            kafka.deleteTopic(topic.name() + "." + group.name() + ".retry");
        }
        if (Boolean.TRUE.equals(deleted.spec().get("dlqEnabled"))) {
            kafka.deleteTopic(topic.name() + "." + group.name() + ".dlq");
        }
        return deleted;
    }

    private SubscriptionView find(long id) {
        return jdbc.sql("SELECT * FROM subscription WHERE id = :id AND state <> 9")
                .param("id", id)
                .query(SubscriptionService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "NOT_FOUND", HttpStatus.NOT_FOUND, "subscription does not exist"));
    }

    private ResourceRef group(long id) {
        return jdbc.sql("""
                        SELECT id, name, owner, 1 AS partitions
                        FROM consume_group
                        WHERE id = :id AND state <> 9
                        """)
                .param("id", id)
                .query((row, number) -> new ResourceRef(
                        row.getLong("id"),
                        row.getString("name"),
                        row.getString("owner"),
                        row.getInt("partitions")))
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("group does not exist"));
    }

    private ResourceRef topic(long id) {
        return jdbc.sql("""
                        SELECT id, name, owner, partitions
                        FROM topic
                        WHERE id = :id AND state <> 9
                        """)
                .param("id", id)
                .query((row, number) -> new ResourceRef(
                        row.getLong("id"),
                        row.getString("name"),
                        row.getString("owner"),
                        row.getInt("partitions")))
                .optional()
                .orElseThrow(() -> new IllegalArgumentException("topic does not exist"));
    }

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("subscription spec cannot be encoded", exception);
        }
    }

    private void requireCompatibleShareLock(
            long groupId, Map<String, Object> spec, Long excludedId) {
        Integer requested = shareLockDuration(spec);
        if (requested == null) {
            return;
        }
        List<Map<String, Object>> existing = jdbc.sql("""
                        SELECT spec
                        FROM subscription
                        WHERE group_id = :groupId
                          AND state <> 9
                          AND (:excludedId IS NULL OR id <> :excludedId)
                        """)
                .param("groupId", groupId)
                .param("excludedId", excludedId, java.sql.Types.BIGINT)
                .query((row, number) -> decodeSpec(row.getString("spec")))
                .list();
        boolean conflict = existing.stream()
                .map(SubscriptionService::shareLockDuration)
                .filter(java.util.Objects::nonNull)
                .anyMatch(value -> !value.equals(requested));
        if (conflict) {
            throw new IllegalArgumentException(
                    "Share subscriptions in one group must use the same ack timeout");
        }
    }

    private static Integer shareLockDuration(Map<String, Object> spec) {
        if ("PULL".equals(spec.get("mode"))) {
            return PullSubscriptionSpec.from(spec).ackTimeoutMs();
        }
        if ("PUSH".equals(spec.get("mode"))
                && !Boolean.TRUE.equals(spec.get("ordered"))) {
            return 30_000;
        }
        return null;
    }

    private static Map<String, Object> decodeSpec(String json) {
        try {
            return new ObjectMapper().readValue(json, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "stored subscription spec cannot be decoded", exception);
        }
    }

    public static Map<String, Object> payload(
            SubscriptionView subscription, String group, String topic) {
        return Map.of(
                "id", subscription.id(),
                "group", group,
                "topic", topic,
                "owner", subscription.owner(),
                "enabled", subscription.state() == 1,
                "spec", subscription.spec());
    }

    private static SubscriptionView map(ResultSet row, int rowNumber) throws SQLException {
        String specJson = row.getString("spec");
        Map<String, Object> spec;
        try {
            spec = new ObjectMapper().readValue(specJson, new TypeReference<>() {});
        } catch (JsonProcessingException exception) {
            throw new SQLException("subscription spec cannot be decoded", exception);
        }
        return new SubscriptionView(
                row.getLong("id"),
                row.getLong("group_id"),
                row.getLong("topic_id"),
                Map.copyOf(spec),
                row.getShort("state"),
                row.getLong("version"),
                row.getString("owner"),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("updated_at").toInstant());
    }

    private record ResourceRef(long id, String name, String owner, int partitions) {}
}
