package dev.ojbk.console.delay;

import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.audit.OperationAudit;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import dev.ojbk.delay.DelayCommand;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
final class DelayService {
    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final DelayCancellationPublisher cancellations;
    private final OperationAudit audit;

    DelayService(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            DelayCancellationPublisher cancellations,
            OperationAudit audit) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.cancellations = cancellations;
        this.audit = audit;
    }

    DelayView get(String delayId, Actor actor) {
        DelayRow row = find(delayId);
        authorize(row.owner(), actor);
        return row.view(false);
    }

    DelayView cancel(String delayId, Actor actor) {
        DelayRow row = find(delayId);
        authorize(row.owner(), actor);
        if (row.status() != 0) {
            throw new ApiException(
                    "DELAY_NOT_PENDING",
                    HttpStatus.CONFLICT,
                    "only a pending delay can be canceled");
        }
        cancellations.publish(
                DelayCommand.cancel(row.delayId(), row.targetTopic()));
        audit.record(
                actor.username(),
                "DELAY_CANCEL_REQUESTED",
                "DELAY",
                row.delayId(),
                Map.of("targetTopic", row.targetTopic()));
        return row.view(true);
    }

    private DelayRow find(String delayId) {
        if (delayId == null
                || !delayId.matches("[A-Za-z0-9._:-]{1,128}")) {
            throw new IllegalArgumentException("delayId is invalid");
        }
        return jdbc.sql("""
                        SELECT d.*, t.owner
                        FROM delay_message d
                        LEFT JOIN topic t
                          ON t.name = d.target_topic AND t.state <> 9
                        WHERE d.delay_id = :delayId
                        """)
                .param("delayId", delayId)
                .query(DelayService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "DELAY_NOT_FOUND",
                        HttpStatus.NOT_FOUND,
                        "delay does not exist"));
    }

    private void authorize(String owner, Actor actor) {
        if (owner != null) {
            authorization.requireOwnerOrAdmin(owner, actor);
        } else {
            authorization.requireOperator(actor);
        }
    }

    private static DelayRow map(ResultSet row, int number)
            throws SQLException {
        return new DelayRow(
                row.getString("delay_id"),
                row.getString("target_topic"),
                row.getShort("status"),
                row.getTimestamp("due_at").toInstant(),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("fired_at") == null
                        ? null
                        : row.getTimestamp("fired_at").toInstant(),
                (Long) row.getObject("loop_interval_ms"),
                (Integer) row.getObject("loop_remaining"),
                row.getTimestamp("expire_at") == null
                        ? null
                        : row.getTimestamp("expire_at").toInstant(),
                row.getBytes("payload").length,
                row.getString("owner"));
    }

    private record DelayRow(
            String delayId,
            String targetTopic,
            short status,
            java.time.Instant dueAt,
            java.time.Instant createdAt,
            java.time.Instant firedAt,
            Long loopIntervalMs,
            Integer loopRemaining,
            java.time.Instant expireAt,
            int payloadBytes,
            String owner) {

        private DelayView view(boolean cancelRequested) {
            return new DelayView(
                    delayId,
                    targetTopic,
                    switch (status) {
                        case 0 -> "PENDING";
                        case 1 -> "DONE";
                        case 2 -> "CANCELED";
                        case 3 -> "EXPIRED";
                        default -> "UNKNOWN";
                    },
                    dueAt,
                    createdAt,
                    firedAt,
                    loopIntervalMs,
                    loopRemaining,
                    expireAt,
                    payloadBytes,
                    cancelRequested);
        }
    }
}
