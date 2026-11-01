package com.fallrising.cms.identity.store;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditPage;
import com.fallrising.cms.identity.domain.AuditQuery;
import com.fallrising.cms.identity.domain.AuditRetention;
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
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

public class InMemoryIdentityStore implements IdentityStore {
    @Override
    public boolean hasIdentityDataIncludingDeleted() {
        synchronized (adminGuard) {
            return !principals.isEmpty() || !credentials.isEmpty() || !audits.isEmpty()
                    || !sessionsById.isEmpty() || !sessionsByHash.isEmpty()
                    || principalRoles.values().stream().anyMatch(values -> !values.isEmpty())
                    || permissions.values().stream().anyMatch(values -> !values.isEmpty());
        }
    }

    @Override
    public boolean hasMaintenanceOperation(UUID operationId) {
        synchronized (adminGuard) {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            for (var event : audits) {
                if (!"AUTH".equals(event.category()) || !List.of("PRODUCTION_ADMIN_INITIALIZED", "PRODUCTION_ADMIN_RECOVERED").contains(event.action())
                        || event.detailJson() == null) continue;
                try {
                    var id = mapper.readTree(event.detailJson()).path("operationId");
                    if (id.isTextual() && operationId.toString().equals(id.textValue())) return true;
                } catch (Exception ignored) {
                    throw new com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.Failure(
                            com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.FailureCode.MAINTENANCE_INTERNAL_ERROR);
                }
            }
            return false;
        }
    }

    @Override
    public <T> T maintenanceTransaction(java.util.function.Supplier<T> attempt) {
        synchronized (adminGuard) {
            var oldPrincipals = new HashMap<>(principals); var oldUsernames = new HashMap<>(usernameIndex);
            var oldCredentials = new HashMap<>(credentials); var oldRoles = new HashMap<>(roles);
            var oldAssignments = new HashMap<UUID, List<PrincipalRoleAssignment>>();
            principalRoles.forEach((id, values) -> oldAssignments.put(id, new ArrayList<>(values.stream().map(a ->
                    new PrincipalRoleAssignment(a.principalId(), a.roleId(), a.roleCode(), List.copyOf(a.contentTypeCodes()))).toList())));
            var oldPermissions = new HashMap<UUID, List<Permission>>();
            permissions.forEach((id, values) -> oldPermissions.put(id, new ArrayList<>(values.stream().map(p -> new Permission(p.id(), p.roleId(),
                    p.action(), p.contentTypeCode(), p.predicateJson(), List.copyOf(p.allowedSurfaces()), p.createdAt())).toList())));
            var oldSessionsById = copySessions(sessionsById); var oldSessionsByHash = copySessions(sessionsByHash);
            var oldAudits = new ArrayList<>(audits);
            try { return attempt.get(); }
            catch (RuntimeException | Error failure) {
                restore(principals, oldPrincipals); restore(usernameIndex, oldUsernames); restore(credentials, oldCredentials);
                restore(roles, oldRoles); restore(principalRoles, oldAssignments); restore(permissions, oldPermissions);
                restore(sessionsById, oldSessionsById); restore(sessionsByHash, oldSessionsByHash);
                audits.clear(); audits.addAll(oldAudits);
                throw failure;
            }
        }
    }

    private static <K, V> void restore(Map<K, V> target, Map<K, V> previous) { target.clear(); target.putAll(previous); }
    private static <K> Map<K, SessionRecord> copySessions(Map<K, SessionRecord> source) {
        var copy = new HashMap<K, SessionRecord>();
        source.forEach((key, s) -> copy.put(key, new SessionRecord(s.id(), s.principalId(), s.tokenHash().clone(), s.createdAt(),
                s.expiresAt(), s.lastSeenAt(), s.revokedAt(), s.createdSurface(), s.ip(), s.userAgent())));
        return copy;
    }

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
    private volatile AuditRetention auditRetention = new AuditRetention(AuditRetention.DEFAULT_DAYS, Instant.now(), null);

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
    public AuditPage queryAudits(AuditQuery query) {
        List<AuditEvent> matching = audits.stream()
                .filter(e -> query.from() == null || !e.at().isBefore(query.from()))
                .filter(e -> query.to() == null || e.at().isBefore(query.to()))
                .filter(e -> query.actorId() == null || query.actorId().equals(e.actorPrincipalId()))
                .filter(e -> query.action() == null
                        || (query.actionPrefix() ? e.action().startsWith(query.action()) : query.action().equals(e.action())))
                .filter(e -> query.category() == null || query.category().equals(e.category()))
                .filter(e -> query.targetType() == null || query.targetType().equals(e.targetType()))
                .filter(e -> query.targetId() == null || query.targetId().equals(e.targetId()))
                .filter(e -> query.outcome() == null || query.outcome().equals(e.outcome()))
                .sorted(Comparator.comparing(AuditEvent::at).reversed().thenComparing(e -> e.id().toString()))
                .toList();
        return new AuditPage(matching.stream().skip(query.offset()).limit(query.size()).toList(), matching.size());
    }

    @Override
    public Optional<AuditEvent> findAudit(UUID id) {
        return audits.stream().filter(e -> e.id().equals(id)).findFirst();
    }

    @Override
    public AuditRetention auditRetention() {
        return auditRetention;
    }

    @Override
    public void updateAuditRetention(AuditRetention retention) {
        auditRetention = retention;
    }

    @Override
    public int deleteAuditsBefore(Instant cutoff) {
        List<AuditEvent> expired = audits.stream().filter(event -> event.at().isBefore(cutoff)).toList();
        audits.removeAll(expired);
        return expired.size();
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
