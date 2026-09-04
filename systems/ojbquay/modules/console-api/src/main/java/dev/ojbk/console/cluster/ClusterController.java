package dev.ojbk.console.cluster;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/clusters")
public final class ClusterController {
    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final ClusterOperations operations;

    ClusterController(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            ClusterOperations operations) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.operations = operations;
    }

    @GetMapping
    ApiResponse<List<ClusterView>> list(Authentication authentication) {
        authorization.requireOperator(Actor.from(authentication));
        return ApiResponse.ok(jdbc.sql("""
                        SELECT id, name, bootstrap_servers, is_default,
                               created_at
                        FROM kafka_cluster
                        ORDER BY is_default DESC, id
                        """)
                .query((row, number) -> new ClusterView(
                        row.getLong("id"),
                        row.getString("name"),
                        row.getString("bootstrap_servers"),
                        row.getBoolean("is_default"),
                        row.getTimestamp("created_at").toInstant()))
                .list());
    }

    @GetMapping("/{id}/health")
    ApiResponse<ClusterHealth> health(
            @PathVariable long id, Authentication authentication) {
        authorization.requireOperator(Actor.from(authentication));
        Boolean defaultCluster = jdbc.sql("""
                        SELECT is_default
                        FROM kafka_cluster
                        WHERE id = :id
                        """)
                .param("id", id)
                .query(Boolean.class)
                .optional()
                .orElse(null);
        if (defaultCluster == null) {
            throw new dev.ojbk.console.api.ApiException(
                    "NOT_FOUND",
                    org.springframework.http.HttpStatus.NOT_FOUND,
                    "cluster does not exist");
        }
        if (!defaultCluster) {
            throw new dev.ojbk.console.api.ApiException(
                    "UNSUPPORTED",
                    org.springframework.http.HttpStatus.UNPROCESSABLE_CONTENT,
                    "health probes are available for the configured default cluster");
        }
        return ApiResponse.ok(operations.health());
    }
}
