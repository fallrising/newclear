package dev.ojbk.console.configuration;

import dev.ojbk.config.ConfigEventCodec;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigPublisher;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@ConditionalOnProperty(
        name = "ojbquay.outbox.enabled",
        havingValue = "true",
        matchIfMissing = true)
public class OutboxPublisher {
    private final JdbcClient jdbc;
    private final ConfigPublisher publisher;
    private final ConfigEventCodec codec = new ConfigEventCodec();

    OutboxPublisher(JdbcClient jdbc, ConfigPublisher publisher) {
        this.jdbc = jdbc;
        this.publisher = publisher;
    }

    @Scheduled(
            fixedDelayString = "${ojbquay.outbox.interval:1s}",
            initialDelayString = "${ojbquay.outbox.initial-delay:0s}")
    @Transactional
    public int publishPending() {
        List<OutboxRow> rows = jdbc.sql("""
                        SELECT id, aggregate_type, aggregate_id, event_type, payload::text
                        FROM outbox_event
                        WHERE published_at IS NULL
                        ORDER BY id
                        LIMIT 100
                        FOR UPDATE SKIP LOCKED
                        """)
                .query((row, number) -> new OutboxRow(
                        row.getLong("id"),
                        ConfigEntityType.valueOf(row.getString("aggregate_type")),
                        row.getString("aggregate_id"),
                        row.getString("event_type"),
                        row.getString("payload")))
                .list();
        int published = 0;
        for (OutboxRow row : rows) {
            try {
                if ("CONFIG_DELETED".equals(row.eventType())) {
                    publisher.delete(row.entityType(), row.entityId());
                } else {
                    publisher.publish(
                            codec.decode(row.payload().getBytes(StandardCharsets.UTF_8)));
                }
                jdbc.sql("""
                                UPDATE outbox_event
                                SET published_at = now(), last_error = NULL
                                WHERE id = :id
                                """)
                        .param("id", row.id())
                        .update();
                published++;
            } catch (RuntimeException exception) {
                String error = exception.getClass().getSimpleName();
                jdbc.sql("""
                                UPDATE outbox_event
                                SET retry_count = retry_count + 1, last_error = :error
                                WHERE id = :id
                                """)
                        .param("error", error)
                        .param("id", row.id())
                        .update();
            }
        }
        return published;
    }

    private record OutboxRow(
            long id,
            ConfigEntityType entityType,
            String entityId,
            String eventType,
            String payload) {}
}
