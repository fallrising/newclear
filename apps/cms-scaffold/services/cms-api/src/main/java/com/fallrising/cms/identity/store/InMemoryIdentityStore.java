package com.fallrising.cms.identity.store;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Credential;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.SessionRecord;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class InMemoryIdentityStore implements IdentityStore {

    private final ConcurrentHashMap<UUID, Principal> principals = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, UUID> usernameIndex = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, Credential> credentials = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Role> roles = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<PrincipalRoleAssignment>> principalRoles = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, List<Permission>> permissions = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, SessionRecord> sessionsByHash = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<UUID, SessionRecord> sessionsById = new ConcurrentHashMap<>();
    private final CopyOnWriteArrayList<AuditEvent> audits = new CopyOnWriteArrayList<>();
    private final Object adminGuard = new Object();

    @Override
    public Optional<Principal> findPrincipalById(UUID id) {
        return Optional.ofNullable(principals.get(id)).filter(p -> !p.deleted());
    }

    @Override
    public Optional<Principal> findPrincipalByUsername(String username) {
        if (username == null) {
            return Optional.empty();
        }
        UUID id = usernameIndex.get(username.toLowerCase(Locale.ROOT));
        return id == null ? Optional.empty() : findPrincipalById(id);
    }

    @Override
    public List<Principal> listPrincipals() {
        return principals.values().stream()
                .filter(p -> !p.deleted())
                .sorted(Comparator.comparing(Principal::username))
                .toList();
    }

    @Override
    public Principal insertPrincipal(Principal principal) {
        String key = principal.username().toLowerCase(Locale.ROOT);
        if (usernameIndex.putIfAbsent(key, principal.id()) != null) {
            throw new IllegalStateException("username taken");
        }
        principals.put(principal.id(), principal);
        return principal;
    }

    @Override
    public Principal updatePrincipal(Principal principal) {
        principals.put(principal.id(), principal);
        return principal;
    }

    @Override
    public void upsertPasswordCredential(UUID principalId, String secretHash, String algo) {
        Credential existing = credentials.get(principalId);
        UUID id = existing == null ? UUID.randomUUID() : existing.id();
        credentials.put(principalId, new Credential(id, principalId, "password", secretHash, algo, Instant.now()));
    }

    @Override
    public Optional<Credential> findPasswordCredential(UUID principalId) {
        return Optional.ofNullable(credentials.get(principalId));
    }

    @Override
    public List<Role> listRoles() {
        return roles.values().stream().sorted(Comparator.comparing(Role::code)).toList();
    }

    @Override
    public Optional<Role> findRoleByCode(String code) {
        return Optional.ofNullable(roles.get(code));
    }

    @Override
    public void insertRole(Role role) {
        roles.put(role.code(), role);
    }

    @Override
    public List<PrincipalRoleAssignment> rolesOf(UUID principalId) {
        return List.copyOf(principalRoles.getOrDefault(principalId, List.of()));
    }

    @Override
    public void replacePrincipalRoles(UUID principalId, List<PrincipalRoleAssignment> assignments) {
        principalRoles.put(principalId, new ArrayList<>(assignments));
    }

    @Override
    public List<Permission> permissionsOfRole(UUID roleId) {
        return permissions.getOrDefault(roleId, List.of()).stream()
                .sorted(Comparator.comparing(Permission::action))
                .toList();
    }

    @Override
    public void replaceRolePermissions(UUID roleId, List<Permission> next) {
        permissions.put(roleId, new ArrayList<>(next));
    }

    @Override
    public void insertPermission(Permission permission) {
        permissions.computeIfAbsent(permission.roleId(), ignored -> new CopyOnWriteArrayList<>()).add(permission);
    }

    @Override
    public SessionRecord insertSession(SessionRecord session) {
        sessionsById.put(session.id(), session);
        sessionsByHash.put(hashKey(session.tokenHash()), session);
        return session;
    }

    @Override
    public Optional<SessionRecord> findSessionByTokenHash(byte[] tokenHash) {
        return Optional.ofNullable(sessionsByHash.get(hashKey(tokenHash)));
    }

    @Override
    public boolean touchSession(UUID sessionId, Instant lastSeenAt, Instant expiresAt, Instant now) {
        final boolean[] touched = {false};
        sessionsById.computeIfPresent(sessionId, (id, current) -> {
            if (current.revoked() || current.expired(now)) {
                return current;
            }
            SessionRecord next = current.seen(lastSeenAt, expiresAt);
            sessionsByHash.put(hashKey(next.tokenHash()), next);
            touched[0] = true;
            return next;
        });
        return touched[0];
    }

    @Override
    public void revokeSession(UUID sessionId, Instant at) {
        sessionsById.computeIfPresent(sessionId, (id, current) -> {
            SessionRecord next = current.revoked() ? current : current.revoke(at);
            sessionsByHash.put(hashKey(next.tokenHash()), next);
            return next;
        });
    }

    @Override
    public void revokeAllForPrincipal(UUID principalId, Instant at, UUID exceptSessionId) {
        for (UUID sessionId : List.copyOf(sessionsById.keySet())) {
            sessionsById.computeIfPresent(sessionId, (id, current) -> {
                if (!current.principalId().equals(principalId)
                        || (exceptSessionId != null && current.id().equals(exceptSessionId))
                        || current.revoked()) {
                    return current;
                }
                SessionRecord next = current.revoke(at);
                sessionsByHash.put(hashKey(next.tokenHash()), next);
                return next;
            });
        }
    }

    @Override
    public void insertAudit(AuditEvent event) {
        audits.add(event);
    }

    @Override
    public List<AuditEvent> listAudits(String action, UUID targetId) {
        return audits.stream()
                .filter(event -> action == null || action.isBlank() || action.equals(event.action()))
                .filter(event -> targetId == null || targetId.equals(event.targetId()))
                .sorted(Comparator.comparing(AuditEvent::at).reversed())
                .toList();
    }

    @Override
    public long countUsableAdmins() {
        return listPrincipals().stream().filter(this::isUsableAdmin).count();
    }

    @Override
    public void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments) {
        synchronized (adminGuard) {
            List<PrincipalRoleAssignment> previous = rolesOf(principalId);
            replacePrincipalRoles(principalId, assignments);
            if (countUsableAdmins() == 0) {
                replacePrincipalRoles(principalId, previous);
                throw IdentityException.lastAdmin();
            }
        }
    }

    @Override
    public Principal updatePrincipalKeepingUsableAdmin(Principal principal) {
        synchronized (adminGuard) {
            Principal previous = principals.get(principal.id());
            updatePrincipal(principal);
            if (countUsableAdmins() == 0) {
                if (previous != null) {
                    principals.put(previous.id(), previous);
                }
                throw IdentityException.lastAdmin();
            }
            return principal;
        }
    }

    @Override
    public void replaceRolePermissionsKeepingUsableAdmin(UUID roleId, List<Permission> next) {
        synchronized (adminGuard) {
            List<Permission> previous = permissionsOfRole(roleId);
            replaceRolePermissions(roleId, next);
            if (countUsableAdmins() == 0) {
                replaceRolePermissions(roleId, previous);
                throw IdentityException.lastAdmin();
            }
        }
    }

    private boolean isUsableAdmin(Principal principal) {
        if (principal.status() != PrincipalStatus.ACTIVE) {
            return false;
        }
        Optional<PrincipalRoleAssignment> adminAssignment = rolesOf(principal.id()).stream()
                .filter(r -> RoleCode.ADMIN.wire().equals(r.roleCode()))
                .findFirst();
        if (adminAssignment.isEmpty()) {
            return false;
        }
        return permissionsOfRole(adminAssignment.get().roleId()).stream()
                .anyMatch(p -> "manage_principals".equals(p.action()) && p.allowedSurfaces().contains("admin"));
    }

    private static String hashKey(byte[] hash) {
        return Arrays.toString(hash);
    }
}
