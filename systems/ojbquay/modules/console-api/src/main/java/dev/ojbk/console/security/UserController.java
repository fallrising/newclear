package dev.ojbk.console.security;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.api.StateRequest;
import dev.ojbk.console.audit.OperationAudit;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/users")
public final class UserController {
    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final PasswordEncoder passwordEncoder;
    private final OperationAudit audit;

    UserController(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            PasswordEncoder passwordEncoder,
            OperationAudit audit) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
    }

    @GetMapping
    ApiResponse<List<UserView>> list(Authentication authentication) {
        authorization.requireAdmin(Actor.from(authentication));
        return ApiResponse.ok(jdbc.sql("""
                        SELECT id, username, role, enabled, created_at
                        FROM app_user
                        ORDER BY username
                        """)
                .query(UserController::map)
                .list());
    }

    @PostMapping
    ResponseEntity<ApiResponse<UserView>> create(
            @Valid @RequestBody CreateUserRequest request,
            Authentication authentication) {
        Actor actor = Actor.from(authentication);
        authorization.requireAdmin(actor);
        UserView created = jdbc.sql("""
                        INSERT INTO app_user
                          (username, password_hash, role)
                        VALUES
                          (:username, :password, :role)
                        RETURNING id, username, role, enabled, created_at
                        """)
                .param("username", request.username())
                .param("password", passwordEncoder.encode(request.password()))
                .param("role", request.role())
                .query(UserController::map)
                .single();
        audit.record(
                actor.username(),
                "USER_CREATED",
                "USER",
                created.username(),
                Map.of("role", created.role()));
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.ok(created));
    }

    @PostMapping("/{id}/state")
    ApiResponse<UserView> state(
            @PathVariable long id,
            @RequestBody StateRequest request,
            Authentication authentication) {
        Actor actor = Actor.from(authentication);
        authorization.requireAdmin(actor);
        UserView updated = jdbc.sql("""
                        UPDATE app_user
                        SET enabled = :enabled
                        WHERE id = :id
                        RETURNING id, username, role, enabled, created_at
                        """)
                .param("enabled", request.enabled())
                .param("id", id)
                .query(UserController::map)
                .optional()
                .orElseThrow(() -> new dev.ojbk.console.api.ApiException(
                        "NOT_FOUND",
                        HttpStatus.NOT_FOUND,
                        "user does not exist"));
        audit.record(
                actor.username(),
                request.enabled() ? "USER_ENABLED" : "USER_DISABLED",
                "USER",
                updated.username(),
                Map.of("enabled", request.enabled()));
        return ApiResponse.ok(updated);
    }

    private static UserView map(java.sql.ResultSet row, int number)
            throws java.sql.SQLException {
        return new UserView(
                row.getLong("id"),
                row.getString("username"),
                row.getString("role"),
                row.getBoolean("enabled"),
                row.getTimestamp("created_at").toInstant());
    }
}
