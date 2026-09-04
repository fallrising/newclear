package dev.ojbk.console.dlq;

import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.kafka.KafkaDlqOperations;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public final class DlqService {
    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final KafkaDlqOperations kafka;

    DlqService(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            KafkaDlqOperations kafka) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.kafka = kafka;
    }

    public List<DlqRecordView> browse(long subscriptionId, int limit, Actor actor) {
        if (limit < 1 || limit > 500) {
            throw new IllegalArgumentException("DLQ read limit must be 1..500");
        }
        Target target = target(subscriptionId, actor);
        try {
            return kafka.readTail(target.dlqTopic(), limit);
        } catch (IllegalStateException unavailable) {
            throw brokerUnavailable(unavailable);
        }
    }

    public ReplayDlqResult replay(
            long subscriptionId, ReplayDlqRequest request, Actor actor) {
        Target target = target(subscriptionId, actor);
        try {
            kafka.replay(target.dlqTopic(), target.sourceTopic(), request.records());
        } catch (IllegalStateException unavailable) {
            throw brokerUnavailable(unavailable);
        }
        jdbc.sql("""
                        INSERT INTO audit_log (actor, action, entity, entity_id, detail)
                        VALUES (
                          :actor, 'DLQ_REPLAYED', 'SUBSCRIPTION', :entityId,
                          CAST(:detail AS jsonb)
                        )
                        """)
                .param("actor", actor.username())
                .param("entityId", Long.toString(subscriptionId))
                .param("detail", "{\"replayed\":" + request.records().size() + "}")
                .update();
        return new ReplayDlqResult(request.records().size());
    }

    private Target target(long subscriptionId, Actor actor) {
        Target target = jdbc.sql("""
                        SELECT s.owner, t.name AS source_topic, g.name AS group_name,
                               COALESCE((s.spec ->> 'dlqEnabled')::boolean, false)
                                 AS dlq_enabled
                        FROM subscription s
                        JOIN topic t ON t.id = s.topic_id
                        JOIN consume_group g ON g.id = s.group_id
                        WHERE s.id = :id
                          AND s.state <> 9
                          AND t.state <> 9
                          AND g.state <> 9
                        """)
                .param("id", subscriptionId)
                .query((row, number) -> new Target(
                        row.getString("owner"),
                        row.getString("source_topic"),
                        row.getString("group_name"),
                        row.getBoolean("dlq_enabled")))
                .optional()
                .orElseThrow(() -> new ApiException(
                        "NOT_FOUND",
                        HttpStatus.NOT_FOUND,
                        "subscription does not exist"));
        authorization.requireOwnerOrAdmin(target.owner(), actor);
        if (!target.dlqEnabled()) {
            throw new ApiException(
                    "DLQ_DISABLED",
                    HttpStatus.CONFLICT,
                    "subscription does not have DLQ enabled");
        }
        return target;
    }

    private static ApiException brokerUnavailable(IllegalStateException failure) {
        return new ApiException(
                "BROKER_UNAVAILABLE",
                HttpStatus.SERVICE_UNAVAILABLE,
                "DLQ broker operation failed",
                failure);
    }

    private record Target(
            String owner, String sourceTopic, String group, boolean dlqEnabled) {
        private String dlqTopic() {
            return sourceTopic + "." + group + ".dlq";
        }
    }
}
