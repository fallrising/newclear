package dev.ojbk.console.group;

import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.console.api.ApiException;
import dev.ojbk.console.configuration.ChangeRecorder;
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
public class GroupService {
    private final JdbcClient jdbc;
    private final ChangeRecorder changes;
    private final ResourceAuthorization authorization;
    private final SecureRandom random = new SecureRandom();

    GroupService(
            JdbcClient jdbc, ChangeRecorder changes, ResourceAuthorization authorization) {
        this.jdbc = jdbc;
        this.changes = changes;
        this.authorization = authorization;
    }

    @Transactional
    public GroupView create(CreateGroupRequest request, Actor actor) {
        GroupView group = jdbc.sql("""
                        INSERT INTO consume_group (name, token, owner, remark)
                        VALUES (:name, :token, :owner, :remark)
                        RETURNING *
                        """)
                .param("name", request.name())
                .param("token", token())
                .param("owner", actor.username())
                .param("remark", request.remark() == null ? "" : request.remark())
                .query(GroupService::map)
                .single();
        changes.record(
                ConfigEntityType.GROUP,
                group.name(),
                group.version(),
                actor.username(),
                "GROUP_CREATED",
                payload(group));
        return group;
    }

    public List<GroupView> list(Actor actor) {
        if (actor.isAdmin() || actor.isOps()) {
            return jdbc.sql("SELECT * FROM consume_group WHERE state <> 9 ORDER BY id")
                    .query(GroupService::map)
                    .list();
        }
        return jdbc.sql("""
                        SELECT * FROM consume_group
                        WHERE state <> 9 AND owner = :owner
                        ORDER BY id
                        """)
                .param("owner", actor.username())
                .query(GroupService::map)
                .list();
    }

    @Transactional
    public GroupView changeState(long id, boolean enabled, Actor actor) {
        GroupView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        short state = enabled ? (short) 1 : (short) 0;
        if (current.state() == state) {
            return current;
        }
        GroupView updated = jdbc.sql("""
                        UPDATE consume_group
                        SET state = :state, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("state", state)
                .param("id", id)
                .param("version", current.version())
                .query(GroupService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "group changed concurrently"));
        changes.record(
                ConfigEntityType.GROUP,
                updated.name(),
                updated.version(),
                actor.username(),
                enabled ? "GROUP_ENABLED" : "GROUP_DISABLED",
                payload(updated));
        return updated;
    }

    @Transactional
    public GroupView delete(long id, Actor actor) {
        GroupView current = find(id);
        authorization.requireOwnerOrAdmin(current.owner(), actor);
        long subscriptions = jdbc.sql("""
                        SELECT count(*) FROM subscription
                        WHERE group_id = :id AND state <> 9
                        """)
                .param("id", id)
                .query(Long.class)
                .single();
        if (subscriptions > 0) {
            throw new ApiException(
                    "RESOURCE_IN_USE",
                    HttpStatus.CONFLICT,
                    "delete subscriptions before deleting the group");
        }
        GroupView deleted = jdbc.sql("""
                        UPDATE consume_group
                        SET state = 9, version = version + 1, updated_at = now()
                        WHERE id = :id AND version = :version
                        RETURNING *
                        """)
                .param("id", id)
                .param("version", current.version())
                .query(GroupService::map)
                .optional()
                .orElseThrow(() -> new ApiException(
                        "CONFLICT", HttpStatus.CONFLICT, "group changed concurrently"));
        changes.recordDelete(
                ConfigEntityType.GROUP,
                deleted.name(),
                deleted.version(),
                actor.username(),
                "GROUP_DELETED",
                payload(deleted));
        return deleted;
    }

    private GroupView find(long id) {
        return jdbc.sql("SELECT * FROM consume_group WHERE id = :id AND state <> 9")
                .param("id", id)
                .query(GroupService::map)
                .optional()
                .orElseThrow(() ->
                        new ApiException("NOT_FOUND", HttpStatus.NOT_FOUND, "group does not exist"));
    }

    private static GroupView map(ResultSet row, int rowNumber) throws SQLException {
        return new GroupView(
                row.getLong("id"),
                row.getString("name"),
                row.getString("token").trim(),
                row.getString("owner"),
                row.getShort("state"),
                row.getLong("version"),
                row.getString("remark"),
                row.getTimestamp("created_at").toInstant(),
                row.getTimestamp("updated_at").toInstant());
    }

    static Map<String, Object> payload(GroupView group) {
        return Map.of(
                "name", group.name(),
                "token", group.token(),
                "owner", group.owner(),
                "enabled", group.state() == 1);
    }

    private String token() {
        byte[] bytes = new byte[16];
        random.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
