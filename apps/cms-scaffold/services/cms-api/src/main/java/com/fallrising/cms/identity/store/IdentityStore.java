package com.fallrising.cms.identity.store;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Credential;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.SessionRecord;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface IdentityStore {

    Optional<Principal> findPrincipalById(UUID id);

    Optional<Principal> findPrincipalByUsername(String username);

    List<Principal> listPrincipals();

    Principal insertPrincipal(Principal principal);

    Principal updatePrincipal(Principal principal);

    void upsertPasswordCredential(UUID principalId, String secretHash, String algo);

    Optional<Credential> findPasswordCredential(UUID principalId);

    List<Role> listRoles();

    Optional<Role> findRoleByCode(String code);

    void insertRole(Role role);

    List<PrincipalRoleAssignment> rolesOf(UUID principalId);

    void replacePrincipalRoles(UUID principalId, List<PrincipalRoleAssignment> assignments);

    List<Permission> permissionsOfRole(UUID roleId);

    void replaceRolePermissions(UUID roleId, List<Permission> permissions);

    void insertPermission(Permission permission);

    SessionRecord insertSession(SessionRecord session);

    Optional<SessionRecord> findSessionByTokenHash(byte[] tokenHash);

    boolean touchSession(UUID sessionId, Instant lastSeenAt, Instant expiresAt, Instant now);

    void revokeSession(UUID sessionId, Instant at);

    void revokeAllForPrincipal(UUID principalId, Instant at, UUID exceptSessionId);

    void insertAudit(AuditEvent event);

    List<AuditEvent> listAudits(String action, UUID targetId);

    long countUsableAdmins();

    void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments);

    Principal updatePrincipalKeepingUsableAdmin(Principal principal);

    void replaceRolePermissionsKeepingUsableAdmin(UUID roleId, List<Permission> permissions);
}
