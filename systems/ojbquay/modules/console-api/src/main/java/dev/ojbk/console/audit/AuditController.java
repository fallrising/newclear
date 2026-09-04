package dev.ojbk.console.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import java.sql.SQLException;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/audit")
public final class AuditController {
    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final ObjectMapper objectMapper = new ObjectMapper();

    AuditController(JdbcClient jdbc, ResourceAuthorization authorization) {
        this.jdbc = jdbc;
        this.authorization = authorization;
    }

    @GetMapping
    ApiResponse<AuditPage> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            Authentication authentication) {
        authorization.requireOperator(Actor.from(authentication));
        if (page < 0 || size < 1 || size > 200) {
            throw new IllegalArgumentException("page must be non-negative and size must be 1..200");
        }
        long total = jdbc.sql("SELECT count(*) FROM audit_log").query(Long.class).single();
        var entries = jdbc.sql("""
                        SELECT * FROM audit_log
                        ORDER BY at DESC, id DESC
                        LIMIT :limit OFFSET :offset
                        """)
                .param("limit", size)
                .param("offset", Math.multiplyExact(page, size))
                .query((row, number) -> {
                    try {
                        Map<String, Object> detail = objectMapper.readValue(
                                row.getString("detail"), new TypeReference<>() {});
                        return new AuditEntry(
                                row.getLong("id"),
                                row.getString("actor"),
                                row.getString("action"),
                                row.getString("entity"),
                                row.getString("entity_id"),
                                detail,
                                row.getTimestamp("at").toInstant());
                    } catch (JsonProcessingException exception) {
                        throw new SQLException("audit detail cannot be decoded", exception);
                    }
                })
                .list();
        return ApiResponse.ok(new AuditPage(entries, total, page, size));
    }
}
