package dev.ojbk.console.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public final class OperationAudit {
    private final JdbcClient jdbc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    OperationAudit(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void record(
            String actor,
            String action,
            String entity,
            String entityId,
            Map<String, Object> detail) {
        try {
            jdbc.sql("""
                            INSERT INTO audit_log
                              (actor, action, entity, entity_id, detail)
                            VALUES
                              (:actor, :action, :entity, :entityId, CAST(:detail AS jsonb))
                            """)
                    .param("actor", actor)
                    .param("action", action)
                    .param("entity", entity)
                    .param("entityId", entityId)
                    .param("detail", objectMapper.writeValueAsString(detail))
                    .update();
        } catch (JsonProcessingException invalid) {
            throw new IllegalArgumentException(
                    "audit detail cannot be encoded", invalid);
        }
    }
}
