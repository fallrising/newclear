package com.fallrising.cms.identity.store;

import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.AuditPage;
import com.fallrising.cms.identity.domain.AuditQuery;
import com.fallrising.cms.identity.domain.AuditRetention;
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
import java.util.function.Supplier;

public interface IdentityStore {
    boolean hasIdentityDataIncludingDeleted();
    boolean hasMaintenanceOperation(UUID operationId);
    <T> T maintenanceTransaction(Supplier<T> attempt);

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

    /** Audit search with paging (02 §4.6, B-07). */
    AuditPage queryAudits(AuditQuery query);

    Optional<AuditEvent> findAudit(UUID id);

    /** The singleton setting defaults to 90 days with no updating principal. */
    AuditRetention auditRetention();

    void updateAuditRetention(AuditRetention retention);

    /** Deletes events strictly before cutoff, retaining events at the boundary. */
    int deleteAuditsBefore(Instant cutoff);

    long countUsableAdmins();

    void replacePrincipalRolesKeepingUsableAdmin(UUID principalId, List<PrincipalRoleAssignment> assignments);

    Principal updatePrincipalKeepingUsableAdmin(Principal principal);

    void replaceRolePermissionsKeepingUsableAdmin(UUID roleId, List<Permission> permissions);
}
