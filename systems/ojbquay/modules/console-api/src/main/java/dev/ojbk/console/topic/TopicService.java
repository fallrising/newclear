package dev.ojbk.console.topic;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.TopicConfig;
import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.configuration.ChangeRecorder;
import dev.ojbk.console.kafka.KafkaAdminOperations;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TopicService {
    private final JdbcClient jdbc;
    private final KafkaAdminOperations kafka;
    private final ChangeRecorder changes;
    private final ResourceAuthorization authorization;
    private final SecureRandom random = new SecureRandom();

    TopicService(
            JdbcClient jdbc,
            KafkaAdminOperations kafka,
            ChangeRecorder changes,
            ResourceAuthorization authorization) {
        this.jdbc = jdbc;
        this.kafka = kafka;
        this.changes = changes;
        this.authorization = authorization;
    }

    @Transactional
    public TopicView create(CreateTopicRequest request, Actor actor) {
        String token = token();
        TopicConfig config = new TopicConfig(
                request.name(),
                request.clusterId(),
                request.partitions(),
                request.replication(),
                request.delayTopic(),
                request.maxMessageBytes(),
                request.retentionMs(),
                request.produceQuotaTps(),
                token,
                actor.username(),
                true);
        TopicView topic = insert(request, config);
        boolean brokerCreated = false;
        try {
            kafka.createTopic(config, request.compression().toLowerCase(java.util.Locale.ROOT));
            brokerCreated = true;
            changes.record(
                    ConfigEntityType.TOPIC,
                    topic.name(),
                    topic.version(),
                    actor.username(),
                    "TOPIC_CREATED",
                    payload(topic));
            return topic;
        } catch (RuntimeException failure) {
            if (brokerCreated) {
                try {
                    kafka.deleteTopic(topic.name());
                } catch (RuntimeException compensationFailure) {
                    failure.addSuppressed(compensationFailure);
                }
            }
            throw new ApiException(
                    "BROKER_UNAVAILABLE",
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "broker could not provision topic");
        }
    }

    public List<TopicView> list(Actor actor) {
        if (actor.isAdmin() || actor.isOps()) {
            return jdbc.sql("SELECT * FROM topic WHERE state <> 9 ORDER BY id")
                    .query(TopicService::map)
                    .list();
        }
        return jdbc.sql("""
                        SELECT * FROM topic
                        WHERE state <> 9 AND owner = :owner
                        ORDER BY id
                        """)
                .param("owner", actor.username())
                .query(TopicService::map)
                .list();
    }

    @Transactional
    public TopicView update(long id, UpdateTopicRequest request, Actor actor) {
        TopicView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        String compression = request.compression().toLowerCase(java.util.Locale.ROOT);
        TopicView updated = jdbc.sql("""
                        UPDATE topic
                        SET max_message_bytes = :maxMessageBytes,
                            retention_ms = :retentionMs,
                            produce_quota_tps = :produceQuotaTps,
                            compression = :compression,
                            remark = :remark,
                            version = version + 1,
                            updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("maxMessageBytes", request.maxMessageBytes())
                .param("retentionMs", request.retentionMs())
                .param("produceQuotaTps", request.produceQuotaTps())
                .param("compression", compression)
                .param("remark", request.remark() == null ? "" : request.remark())
                .param("id", id)
                .param("version", current.version())
                .query(TopicService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "topic changed concurrently"));
        kafka.updateTopicConfig(
                updated.name(),
                updated.maxMessageBytes(),
                updated.retentionMs(),
                updated.compression());
        changes.record(
                ConfigEntityType.TOPIC,
                updated.name(),
                updated.version(),
                actor.username(),
                "TOPIC_UPDATED",
                payload(updated));
        return updated;
    }

    @Transactional
    public TopicView changeState(long id, boolean enabled, Actor actor) {
        TopicView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        short state = enabled ? (short) 1 : (short) 0;
        if (current.state() == state) {
            return current;
        }
        TopicView updated = jdbc.sql("""
                        UPDATE topic
                        SET state = :state, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("state", state)
                .param("id", id)
                .param("version", current.version())
                .query(TopicService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "topic changed concurrently"));
        changes.record(
                ConfigEntityType.TOPIC,
                updated.name(),
                updated.version(),
                actor.username(),
                enabled ? "TOPIC_ENABLED" : "TOPIC_DISABLED",
                payload(updated));
        return updated;
    }

    @Transactional
    public TopicView delete(long id, Actor actor) {
        TopicView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        long subscriptions = jdbc.sql("""
                        SELECT count(*) FROM subscription
                        WHERE topic_id = :id AND state <> 9
                        """)
                .param("id", id)
                .query(Long.class)
                .single();
        if (subscriptions > 0) {
            throw new ApiException(
                    "RESOURCE_IN_USE",
                    HttpStatus.CONFLICT,
                    "delete subscriptions before deleting the topic");
        }
        TopicView deleted = jdbc.sql("""
                        UPDATE topic
                        SET state = 9, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("id", id)
                .param("version", current.version())
                .query(TopicService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "topic changed concurrently"));
        changes.recordDelete(
                ConfigEntityType.TOPIC,
                deleted.name(),
                deleted.version(),
                actor.username(),
                "TOPIC_DELETED",
                payload(deleted));
        kafka.deleteTopic(deleted.name());
        return deleted;
    }

    private TopicView find(long id) {
        return jdbc.sql("SELECT * FROM topic WHERE id = :id AND state <> 9")
                .param("id", id)
                .query(TopicService::map)
                .optional()
                .orElseThrow(() ->
                        new ApiException("NOT_FOUND", HttpStatus.NOT_FOUND, "topic does not exist"));
    }

    private TopicView insert(CreateTopicRequest request, TopicConfig config) {
        return jdbc.sql("""
                        INSERT INTO topic (
                          name, cluster_id, partitions, replication, delay_topic,
                          max_message_bytes, retention_ms, produce_quota_tps,
                          compression, token, owner, remark
                        )
                        VALUES (
                          :name, :clusterId, :partitions, :replication, :delayTopic,
                          :maxMessageBytes, :retentionMs, :produceQuotaTps,
                          :compression, :token, :owner, :remark
                        )
                        RETURNING *
                        """)
                .param("name", config.name())
                .param("clusterId", config.clusterId())
                .param("partitions", config.partitions())
                .param("replication", config.replication())
                .param("delayTopic", config.delayTopic())
                .param("maxMessageBytes", config.maxMessageBytes())
                .param("retentionMs", config.retentionMs())
                .param("produceQuotaTps", config.produceQuotaTps())
                .param("compression", request.compression().toLowerCase(java.util.Locale.ROOT))
                .param("token", config.token())
                .param("owner", config.owner())
                .param("remark", request.remark() == null ? "" : request.remark())
                .query(TopicService::map)
                .single();
    }

    private static TopicView map(ResultSet row, int rowNumber) throws SQLException {
        return new TopicView(
                row.getLong("id"),
                row.getString("name"),
                row.getLong("cluster_id"),
                row.getInt("partitions"),
                row.getInt("replication"),
                row.getBoolean("delay_topic"),
                row.getInt("max_message_bytes"),
                row.getLong("retention_ms"),
                row.getInt("produce_quota_tps"),
                row.getString("compression"),
                row.getString("token").trim(),
                row.getString("owner"),
                row.getShort("state"),
                row.getLong("version"),
                row.getString("remark"),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("updated_at").toInstant());
    }

    public static Map<String, Object> payload(TopicView topic) {
        return Map.ofEntries(
                Map.entry("name", topic.name()),
                Map.entry("clusterId", topic.clusterId()),
                Map.entry("partitions", topic.partitions()),
                Map.entry("replication", topic.replication()),
                Map.entry("delayTopic", topic.delayTopic()),
                Map.entry("maxMessageBytes", topic.maxMessageBytes()),
                Map.entry("retentionMs", topic.retentionMs()),
                Map.entry("produceQuotaTps", topic.produceQuotaTps()),
                Map.entry("compression", topic.compression()),
                Map.entry("token", topic.token()),
                Map.entry("owner", topic.owner()),
                Map.entry("enabled", topic.state() == 1));
    }

    private String token() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
