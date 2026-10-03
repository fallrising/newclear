package com.fallrising.cms.identity.store;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Credential;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.SessionRecord;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.sql.Array;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class JdbcIdentityStore implements IdentityStore {

    private static final long ADMIN_GUARD_KEY = 0x434d5341444d494eL;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public JdbcIdentityStore(DataSource dataSource, TransactionTemplate tx) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.tx = tx;
    }

    @Override
    public Optional<Principal> findPrincipalById(UUID id) {
        return one(jdbc.query("SELECT * FROM cms_principal WHERE id = ? AND deleted_at IS NULL", principalMapper(), id));
    }

    @Override
    public Optional<Principal> findPrincipalByUsername(String username) {
        return one(jdbc.query(
                "SELECT * FROM cms_principal WHERE LOWER(username) = LOWER(?) AND deleted_at IS NULL",
                principalMapper(), username));
    }

    @Override
    public List<Principal> listPrincipals() {
        return jdbc.query("SELECT * FROM cms_principal WHERE deleted_at IS NULL ORDER BY username", principalMapper());
    }

    @Override
    public Principal insertPrincipal(Principal principal) {
        jdbc.update("""
                INSERT INTO cms_principal
                  (id, username, display_name, email, status, failed_login_count, locked_until,
                   last_login_at, created_at, updated_at, deleted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                principal.id(), principal.username(), principal.displayName(), principal.email(), principal.status().wire(),
                principal.failedLoginCount(), ts(principal.lockedUntil()), ts(principal.lastLoginAt()),
                ts(principal.createdAt()), ts(principal.updatedAt()), ts(principal.deletedAt()));
        return principal;
    }

    @Override
    public Principal updatePrincipal(Principal principal) {
        jdbc.update("""
                UPDATE cms_principal SET display_name = ?, email = ?, status = ?, failed_login_count = ?,
                  locked_until = ?, last_login_at = ?, updated_at = ?, deleted_at = ?
                WHERE id = ?
                """,
                principal.displayName(), principal.email(), principal.status().wire(), principal.failedLoginCount(),
                ts(principal.lockedUntil()), ts(principal.lastLoginAt()), ts(principal.updatedAt()), ts(principal.deletedAt()),
                principal.id());
        return principal;
    }

    @Override
    public void upsertPasswordCredential(UUID principalId, String secretHash, String algo) {
        int updated = jdbc.update("""
                UPDATE cms_credential SET secret_hash = ?, algo = ?, rotated_at = now()
                WHERE principal_id = ? AND type = 'password'
                """, secretHash, algo, principalId);
        if (updated == 0) {
            jdbc.update("""
                    INSERT INTO cms_credential (id, principal_id, type, secret_hash, algo, rotated_at)
                    VALUES (?, ?, 'password', ?, ?, now())
                    """, UUID.randomUUID(), principalId, secretHash, algo);
        }
    }

    @Override
    public Optional<Credential> findPasswordCredential(UUID principalId) {
        return one(jdbc.query(
                "SELECT * FROM cms_credential WHERE principal_id = ? AND type = 'password'",
                (rs, n) -> new Credential(rs.getObject("id", UUID.class), rs.getObject("principal_id", UUID.class),
                        rs.getString("type"), rs.getString("secret_hash"), rs.getString("algo"), instant(rs, "rotated_at")),
                principalId));
    }

    @Override
    public List<Role> listRoles() {
        return jdbc.query("SELECT * FROM cms_role ORDER BY code", roleMapper());
    }

    @Override
    public Optional<Role> findRoleByCode(String code) {
        return one(jdbc.query("SELECT * FROM cms_role WHERE code = ?", roleMapper(), code));
    }

    @Override
    public void insertRole(Role role) {
        jdbc.update("INSERT INTO cms_role (id, code, display_name, system, created_at) VALUES (?, ?, ?, ?, ?)",
                role.id(), role.code(), role.displayName(), role.system(), ts(role.createdAt()));
    }

    @Override
    public List<PrincipalRoleAssignment> rolesOf(UUID principalId) {
        return jdbc.query("""
                SELECT pr.principal_id, pr.role_id, r.code AS role_code, pr.content_type_codes
                FROM cms_principal_role pr JOIN cms_role r ON r.id = pr.role_id
                WHERE pr.principal_id = ?
                """,
                (rs, n) -> new PrincipalRoleAssignment(rs.getObject("principal_id", UUID.class),
                        rs.getObject("role_id", UUID.class), rs.getString("role_code"), stringArray(rs, "content_type_codes")),
                principalId);
    }

    @Override
    public void replacePrincipalRoles(UUID principalId, List<PrincipalRoleAssignment> assignments) {
        jdbc.update("DELETE FROM cms_principal_role WHERE principal_id = ?", principalId);
        for (PrincipalRoleAssignment assignment : assignments) {
            insertPrincipalRole(principalId, assignment);
        }
    }

    @Override
    public List<Permission> permissionsOfRole(UUID roleId) {
        return jdbc.query("SELECT * FROM cms_permission WHERE role_id = ? ORDER BY action", permissionMapper(), roleId);
    }

    @Override
    public void replaceRolePermissions(UUID roleId, List<Permission> next) {
        jdbc.update("DELETE FROM cms_permission WHERE role_id = ?", roleId);
        for (Permission permission : next) {
            insertPermission(permission);
        }
    }

    @Override
    public void insertPermission(Permission permission) {
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("""
                    INSERT INTO cms_permission
                      (id, role_id, action, content_type_code, predicate_json, allowed_surfaces, created_at)
                    VALUES (?, ?, ?, ?, CAST(? AS jsonb), ?, ?)
                    """);
            ps.setObject(1, permission.id());
            ps.setObject(2, permission.roleId());
            ps.setString(3, permission.action());
            ps.setString(4, permission.contentTypeCode());
            ps.setString(5, permission.predicateJson());
            ps.setArray(6, con.createArrayOf("text", permission.allowedSurfaces().toArray()));
            ps.setTimestamp(7, ts(permission.createdAt()));
            return ps;
        });
    }

    @Override
    public SessionRecord insertSession(SessionRecord session) {
        jdbc.update("""
                INSERT INTO cms_session
                  (id, principal_id, token_hash, created_at, expires_at, last_seen_at, revoked_at,
                   created_surface, ip, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                session.id(), session.principalId(), session.tokenHash(), ts(session.createdAt()), ts(session.expiresAt()),
                ts(session.lastSeenAt()), ts(session.revokedAt()), session.createdSurface(), session.ip(), session.userAgent());
        return session;
    }

    @Override
    public Optional<SessionRecord> findSessionByTokenHash(byte[] tokenHash) {
        return one(jdbc.query("SELECT * FROM cms_session WHERE token_hash = ?", sessionMapper(), tokenHash));
    }

    @Override
    public boolean touchSession(UUID sessionId, Instant lastSeenAt, Instant expiresAt, Instant now) {
        return jdbc.update("""
                UPDATE cms_session
                SET last_seen_at = ?, expires_at = ?
                WHERE id = ? AND revoked_at IS NULL AND expires_at > ?
                """, ts(lastSeenAt), ts(expiresAt), sessionId, ts(now)) == 1;
    }

    @Override
    public void revokeSession(UUID sessionId, Instant at) {
        jdbc.update("UPDATE cms_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", ts(at), sessionId);
    }

    @Override
    public void revokeAllForPrincipal(UUID principalId, Instant at, UUID exceptSessionId) {
        if (exceptSessionId == null) {
            jdbc.update("UPDATE cms_session SET revoked_at = ? WHERE principal_id = ? AND revoked_at IS NULL", ts(at), principalId);
        } else {
            jdbc.update("""
                    UPDATE cms_session SET revoked_at = ?
                    WHERE principal_id = ? AND id <> ? AND revoked_at IS NULL
                    """, ts(at), principalId, exceptSessionId);
        }
    }

    @Override
    public void insertAudit(AuditEvent event) {
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement("""
                    INSERT INTO cms_audit_event
                      (id, at, actor_principal_id, category, action, target_type, target_id, surface, outcome, ip, detail_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                    """);
            ps.setObject(1, event.id()); ps.setTimestamp(2, ts(event.at())); ps.setObject(3, event.actorPrincipalId());
            ps.setString(4, event.category()); ps.setString(5, event.action()); ps.setString(6, event.targetType());
            ps.setObject(7, event.targetId()); ps.setString(8, event.surface()); ps.setString(9, event.outcome());
            ps.setString(10, event.ip()); ps.setString(11, event.detailJson());
            return ps;
        });
    }

    @Override
    public List<AuditEvent> listAudits(String action, UUID targetId) {
        StringBuilder sql = new StringBuilder("SELECT * FROM cms_audit_event WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (action != null && !action.isBlank()) {
            sql.append(" AND action = ?");
            args.add(action);
        }
        if (targetId != null) {
            sql.append(" AND target_id = ?");
            args.add(targetId);
        }
        sql.append(" ORDER BY at DESC");
        return jdbc.query(sql.toString(), auditMapper(), args.toArray());
    }

    @Override
    public long countUsableAdmins() {
        Long count = jdbc.queryForObject("""
                SELECT COUNT(DISTINCT p.id)
                FROM cms_principal p
                JOIN cms_principal_role pr ON pr.principal_id = p.id
                JOIN cms_role r ON r.id = pr.role_id AND r.code = 'admin'
                JOIN cms_permission perm ON perm.role_id = r.id
                WHERE p.deleted_at IS NULL
                  AND p.status = 'active'
                  AND perm.action = 'manage_principals'
                  AND 'admin' = ANY(perm.allowed_surfaces)
                """, Long.class);
        return count == null ? 0 : count;
    }

    @Override
    public void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments) {
        guarded(() -> replacePrincipalRoles(principalId, assignments));
    }

    @Override
    public Principal updatePrincipalKeepingUsableAdmin(Principal principal) {
        return tx.execute(status -> {
            acquireAdminGuard();
            Principal updated = updatePrincipal(principal);
            ensureUsableAdmin();
            return updated;
        });
    }

    @Override
    public void replaceRolePermissionsKeepingUsableAdmin(UUID roleId, List<Permission> permissions) {
        guarded(() -> replaceRolePermissions(roleId, permissions));
    }

    private void guarded(Runnable mutation) {
        tx.executeWithoutResult(status -> {
            acquireAdminGuard();
            mutation.run();
            ensureUsableAdmin();
        });
    }

    private void acquireAdminGuard() {
        jdbc.query("SELECT pg_advisory_xact_lock(?)", (RowCallbackHandler) rs -> {}, ADMIN_GUARD_KEY);
    }

    private void ensureUsableAdmin() {
        if (countUsableAdmins() == 0) {
            throw IdentityException.lastAdmin();
        }
    }

    private void insertPrincipalRole(UUID principalId, PrincipalRoleAssignment assignment) {
        jdbc.update(con -> {
            PreparedStatement ps = con.prepareStatement(
                    "INSERT INTO cms_principal_role (principal_id, role_id, content_type_codes) VALUES (?, ?, ?)");
            ps.setObject(1, principalId);
            ps.setObject(2, assignment.roleId());
            ps.setArray(3, con.createArrayOf("text", assignment.contentTypeCodes().toArray()));
            return ps;
        });
    }

    private RowMapper<Principal> principalMapper() {
        return (rs, n) -> new Principal(rs.getObject("id", UUID.class), rs.getString("username"), rs.getString("display_name"),
                rs.getString("email"), PrincipalStatus.fromWire(rs.getString("status")), rs.getInt("failed_login_count"),
                instant(rs, "locked_until"), instant(rs, "last_login_at"), instant(rs, "created_at"),
                instant(rs, "updated_at"), instant(rs, "deleted_at"));
    }

    private RowMapper<Role> roleMapper() {
        return (rs, n) -> new Role(rs.getObject("id", UUID.class), rs.getString("code"), rs.getString("display_name"),
                rs.getBoolean("system"), instant(rs, "created_at"));
    }

    private RowMapper<Permission> permissionMapper() {
        return (rs, n) -> new Permission(rs.getObject("id", UUID.class), rs.getObject("role_id", UUID.class),
                rs.getString("action"), rs.getString("content_type_code"), rs.getString("predicate_json"),
                stringArray(rs, "allowed_surfaces"), instant(rs, "created_at"));
    }

    private RowMapper<AuditEvent> auditMapper() {
        return (rs, n) -> new AuditEvent(
                rs.getObject("id", UUID.class),
                instant(rs, "at"),
                rs.getObject("actor_principal_id", UUID.class),
                rs.getString("category"),
                rs.getString("action"),
                rs.getString("target_type"),
                rs.getObject("target_id", UUID.class),
                rs.getString("surface"),
                rs.getString("outcome"),
                rs.getString("ip"),
                rs.getString("detail_json"));
    }

    private RowMapper<SessionRecord> sessionMapper() {
        return (rs, n) -> new SessionRecord(rs.getObject("id", UUID.class), rs.getObject("principal_id", UUID.class),
                rs.getBytes("token_hash"), instant(rs, "created_at"), instant(rs, "expires_at"), instant(rs, "last_seen_at"),
                instant(rs, "revoked_at"), rs.getString("created_surface"), rs.getString("ip"), rs.getString("user_agent"));
    }

    private static Timestamp ts(Instant instant) { return instant == null ? null : Timestamp.from(instant); }

    private static Instant instant(ResultSet rs, String col) throws SQLException {
        Timestamp ts = rs.getTimestamp(col);
        return ts == null ? null : ts.toInstant();
    }

    private static List<String> stringArray(ResultSet rs, String col) throws SQLException {
        Array array = rs.getArray(col);
        if (array == null) return List.of();
        Object raw = array.getArray();
        return raw instanceof String[] strings ? List.of(strings) : List.of();
    }

    private static <T> Optional<T> one(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.getFirst());
    }
}
