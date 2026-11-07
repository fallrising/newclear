package com.fallrising.cms.identity.maintenance;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.PasswordPolicy;
import com.fallrising.cms.identity.domain.*;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.platform.TransactionRunner;

import java.nio.CharBuffer;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import static com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.*;

/** Atomic account maintenance. The host guard supplies the separate writer-stop guarantee. */
public class ProductionIdentityService {
    private final IdentityStore store;
    private final PasswordHasher hasher;
    private final AuditLog audit;
    private final MaintenanceGuard guard;

    public ProductionIdentityService(IdentityStore store, PasswordHasher hasher, TransactionRunner transactions,
                                     AuditLog audit, MaintenanceGuard guard) {
        this.store = Objects.requireNonNull(store);
        this.hasher = Objects.requireNonNull(hasher);
        Objects.requireNonNull(transactions);
        this.audit = Objects.requireNonNull(audit);
        this.guard = Objects.requireNonNull(guard);
    }

    public Result freshInit(Options options, char[] password) {
        validateFreshOptions(options);
        try { PasswordPolicy.validate(options.username(), password == null ? null : CharBuffer.wrap(password)); }
        catch (IdentityException invalid) { throw new Failure(FailureCode.SECRET_INPUT_INVALID); }
        final String encoded;
        try { encoded = hasher.hash(password); }
        catch (Throwable failure) { throw new Failure(FailureCode.MAINTENANCE_INTERNAL_ERROR); }

        MaintenanceGuard.Lease lease = null;
        boolean committed = false;
        Failure primary = null;
        try {
            lease = guard.acquire(options.targetId(), options.operationId(), options.operation());
            var activeLease = lease;
            lease.assertQuiesced();
            UUID principalId = store.maintenanceTransaction(() -> {
                if (!options.targetId().equals(activeLease.targetId()) || activeLease.releaseId() == null
                        || activeLease.releaseId().isBlank()) throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);
                if (store.hasIdentityDataIncludingDeleted() || store.listRoles().stream()
                        .anyMatch(role -> !role.system() || !RoleCode.SYSTEM_CODES.contains(role.code())))
                    throw new Failure(FailureCode.NOT_FRESH);
                Instant now = Instant.now();
                var names = Map.of("anonymous", "Anonymous", "member", "Member", "editor", "Editor",
                        "operator", "Operator", "admin", "Admin");
                for (var role : RoleCode.values()) {
                    if (store.findRoleByCode(role.wire()).isEmpty())
                        store.insertRole(new Role(UUID.randomUUID(), role.wire(), names.get(role.wire()), true, now));
                }
                var admin = store.findRoleByCode("admin").orElseThrow();
                for (var action : CmsAction.values()) {
                    List<String> surfaces = action == CmsAction.READ_PUBLISHED ? List.of("front", "back", "admin")
                            : CmsAction.GOVERNANCE.contains(action) ? List.of("admin") : List.of("back", "admin");
                    store.insertPermission(new Permission(UUID.randomUUID(), admin.id(), action.wire(), null, null, surfaces, now));
                }
                var principal = store.insertPrincipal(new Principal(UUID.randomUUID(), options.username(), options.displayName(),
                        null, PrincipalStatus.ACTIVE, 0, null, null, now, now, null));
                store.upsertPasswordCredential(principal.id(), encoded, hasher.algo());
                store.replacePrincipalRoles(principal.id(), List.of(new PrincipalRoleAssignment(principal.id(), admin.id(), "admin", List.of())));
                audit.record(null, Surface.ADMIN, "AUTH", "PRODUCTION_ADMIN_INITIALIZED", "principal", principal.id(), AuditLog.OK,
                        Map.of("operationId", options.operationId().toString(), "releaseId", activeLease.releaseId(),
                                "targetId", activeLease.targetId(), "mode", Operation.FRESH_INIT.name()));
                if (store.countUsableAdmins() != 1) throw new Failure(FailureCode.MAINTENANCE_INTERNAL_ERROR);
                activeLease.assertQuiesced();
                return principal.id();
            });
            committed = true;
            var result = new Result(options.operationId(), options.operation(), principalId, Instant.now(), lease.releaseId(), lease.targetId());
            lease.recordCommitted(result);
            return result;
        } catch (Throwable failure) {
            primary = committed ? new Failure(FailureCode.COMMITTED_HOST_RESTORE_FAILED)
                    : failure instanceof Failure known ? known : new Failure(FailureCode.MAINTENANCE_INTERNAL_ERROR);
            throw primary;
        } finally {
            if (lease != null) {
                try { lease.close(); }
                catch (Throwable cleanup) {
                    if (primary == null) throw new Failure(committed ? FailureCode.COMMITTED_HOST_RESTORE_FAILED
                            : FailureCode.MAINTENANCE_INTERNAL_ERROR);
                }
            }
        }
    }

    private static void validateFreshOptions(Options options) {
        try {
            if (options.operation() != Operation.FRESH_INIT || options.principalId() != null || options.reenable())
                throw new Failure(FailureCode.INPUT_INVALID);
            var parsed = parse(new String[]{"fresh-init", "--username", options.username(), "--display-name", options.displayName(),
                    "--target-id", options.targetId(), "--operation-id", options.operationId().toString(), "--confirm", "FRESH_INIT"});
            if (!parsed.equals(options)) throw new Failure(FailureCode.INPUT_INVALID);
        } catch (RuntimeException invalid) { throw new Failure(FailureCode.INPUT_INVALID); }
    }

    public Result recoverAdmin(Options options, char[] password) {
        validateRecoveryOptions(options);
        MaintenanceGuard.Lease lease = null;
        boolean committed = false;
        Failure primary = null;
        try {
            lease = guard.acquire(options.targetId(), options.operationId(), options.operation());
            var activeLease = lease;
            lease.assertQuiesced();
            UUID principalId = store.maintenanceTransaction(() -> {
                if (!options.targetId().equals(activeLease.targetId()) || activeLease.releaseId() == null
                        || activeLease.releaseId().isBlank()) throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);
                if (activeLease.backupId() == null || activeLease.backupId().isBlank())
                    throw new Failure(FailureCode.RECOVERY_BACKUP_REQUIRED);
                if (store.hasMaintenanceOperation(options.operationId())) throw new Failure(FailureCode.DUPLICATE_OPERATION);
                var target = store.findPrincipalById(options.principalId()).orElseThrow(() -> new Failure(FailureCode.TARGET_NOT_ADMIN));
                var admin = store.findRoleByCode("admin").orElseThrow(() -> new Failure(FailureCode.TARGET_NOT_ADMIN));
                if (store.rolesOf(target.id()).stream().noneMatch(role -> "admin".equals(role.roleCode()) && admin.id().equals(role.roleId())))
                    throw new Failure(FailureCode.TARGET_NOT_ADMIN);
                if (store.permissionsOfRole(admin.id()).stream().noneMatch(permission -> "manage_principals".equals(permission.action())
                        && permission.allowedSurfaces().contains("admin"))) throw new Failure(FailureCode.ADMIN_GRANTS_DAMAGED);
                if (target.status() == PrincipalStatus.DISABLED && !options.reenable()) throw new Failure(FailureCode.TARGET_DISABLED);
                try { PasswordPolicy.validate(target.username(), password == null ? null : CharBuffer.wrap(password)); }
                catch (IdentityException invalid) { throw new Failure(FailureCode.SECRET_INPUT_INVALID); }
                String encoded = hasher.hash(password);
                Instant now = Instant.now();
                store.upsertPasswordCredential(target.id(), encoded, hasher.algo());
                store.updatePrincipal(target.withLock(0, null, PrincipalStatus.ACTIVE, now));
                store.revokeAllForPrincipal(target.id(), now, null);
                audit.record(null, Surface.ADMIN, "AUTH", "PRODUCTION_ADMIN_RECOVERED", "principal", target.id(), AuditLog.OK,
                        Map.of("operationId", options.operationId().toString(), "releaseId", activeLease.releaseId(),
                                "targetId", activeLease.targetId(), "backupId", activeLease.backupId(), "reenable", options.reenable()));
                activeLease.assertQuiesced();
                return target.id();
            });
            committed = true;
            var result = new Result(options.operationId(), options.operation(), principalId, Instant.now(), lease.releaseId(), lease.targetId());
            lease.recordCommitted(result);
            return result;
        } catch (Throwable failure) {
            primary = committed ? new Failure(FailureCode.COMMITTED_HOST_RESTORE_FAILED)
                    : failure instanceof Failure known ? known : new Failure(FailureCode.MAINTENANCE_INTERNAL_ERROR);
            throw primary;
        } finally {
            if (lease != null) {
                try { lease.close(); }
                catch (Throwable cleanup) {
                    if (primary == null) throw new Failure(committed ? FailureCode.COMMITTED_HOST_RESTORE_FAILED
                            : FailureCode.MAINTENANCE_INTERNAL_ERROR);
                }
            }
        }
    }

    private static void validateRecoveryOptions(Options options) {
        try {
            if (options.operation() != Operation.RECOVER_ADMIN || options.username() != null || options.displayName() != null)
                throw new Failure(FailureCode.INPUT_INVALID);
            var args = new java.util.ArrayList<>(List.of("recover-admin", "--principal-id", options.principalId().toString(),
                    "--target-id", options.targetId(), "--operation-id", options.operationId().toString(), "--confirm", "RECOVER_ADMIN"));
            if (options.reenable()) args.add("--reenable");
            if (!parse(args.toArray(String[]::new)).equals(options)) throw new Failure(FailureCode.INPUT_INVALID);
        } catch (RuntimeException invalid) { throw new Failure(FailureCode.INPUT_INVALID); }
    }
}
