package dev.ojbk.console.configuration;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigEventCodec;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public final class ChangeRecorder {
    private final JdbcClient jdbc;
    private final ConfigEventCodec codec = new ConfigEventCodec();
    private final Clock clock;

    @Autowired
    ChangeRecorder(JdbcClient jdbc) {
        this(jdbc, Clock.systemUTC());
    }

    ChangeRecorder(JdbcClient jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public void record(
            ConfigEntityType type,
            String entityId,
            long version,
            String actor,
            String action,
            Map<String, Object> payload) {
        Instant now = clock.instant();
        ConfigEvent event = new ConfigEvent(1, type, entityId, version, now, actor, payload);
        String eventJson = new String(codec.encode(event), StandardCharsets.UTF_8);
        String payloadJson;
        try {
            payloadJson = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsString(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalArgumentException("config payload cannot be encoded", exception);
        }

        jdbc.sql("""
                        INSERT INTO config_publish
                          (entity_type, entity_id, version, payload, published_by)
                        VALUES (:type, :entityId, :version, CAST(:payload AS jsonb), :actor)
                        """)
                .param("type", type.name())
                .param("entityId", entityId)
                .param("version", version)
                .param("payload", payloadJson)
                .param("actor", actor)
                .update();
        jdbc.sql("""
                        INSERT INTO outbox_event
                          (aggregate_type, aggregate_id, event_type, payload)
                        VALUES (:type, :entityId, 'CONFIG_CHANGED', CAST(:payload AS jsonb))
                        """)
                .param("type", type.name())
                .param("entityId", entityId)
                .param("payload", eventJson)
                .update();
        jdbc.sql("""
                        INSERT INTO audit_log (actor, action, entity, entity_id, detail)
                        VALUES (:actor, :action, :entity, :entityId, CAST(:detail AS jsonb))
                        """)
                .param("actor", actor)
                .param("action", action)
                .param("entity", type.name())
                .param("entityId", entityId)
                .param("detail", payloadJson)
                .update();
    }

    public void recordDelete(
            ConfigEntityType type,
            String entityId,
            long version,
            String actor,
            String action,
            Map<String, Object> auditDetail) {
        String detailJson;
        try {
            detailJson = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsString(auditDetail);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalArgumentException("audit detail cannot be encoded", exception);
        }
        jdbc.sql("""
                        INSERT INTO config_publish
                          (entity_type, entity_id, version, payload, published_by)
                        VALUES (:type, :entityId, :version, NULL, :actor)
                        """)
                .param("type", type.name())
                .param("entityId", entityId)
                .param("version", version)
                .param("actor", actor)
                .update();
        jdbc.sql("""
                        INSERT INTO outbox_event
                          (aggregate_type, aggregate_id, event_type, payload)
                        VALUES (:type, :entityId, 'CONFIG_DELETED', '{}')
                        """)
                .param("type", type.name())
                .param("entityId", entityId)
                .update();
        jdbc.sql("""
                        INSERT INTO audit_log (actor, action, entity, entity_id, detail)
                        VALUES (:actor, :action, :entity, :entityId, CAST(:detail AS jsonb))
                        """)
                .param("actor", actor)
                .param("action", action)
                .param("entity", type.name())
                .param("entityId", entityId)
                .param("detail", detailJson)
                .update();
    }
}
