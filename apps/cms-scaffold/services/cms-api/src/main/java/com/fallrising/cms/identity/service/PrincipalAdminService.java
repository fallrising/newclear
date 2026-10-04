package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@Service
public class PrincipalAdminService {

    private static final Pattern USERNAME = Pattern.compile("^[a-z0-9._-]{3,32}$");
    private static final Set<String> SURFACES = Set.of("front", "back", "admin");

    public record CreatedPrincipal(Principal principal, String temporaryPassword) {}
    public record RoleAssignmentInput(String code, List<String> contentTypeCodes) {}

    private final IdentityStore store;
    private final PasswordHasher passwordHasher;
    private final AuthService authService;
    private final AuthorizationService authorizationService;
    private final ObjectMapper objectMapper;
    private final ContentTypeDirectory contentTypes;
    private final TransactionRunner transactions;
    private final AuditLog auditLog;

    public PrincipalAdminService(IdentityStore store, PasswordHasher passwordHasher, AuthService authService,
            AuthorizationService authorizationService, ObjectMapper objectMapper, ContentTypeDirectory contentTypes) {
        this(store, passwordHasher, authService, authorizationService, objectMapper, contentTypes,
                TransactionRunner.withoutDatabase(), new AuditLog(store, objectMapper));
    }

    @org.springframework.beans.factory.annotation.Autowired
    public PrincipalAdminService(IdentityStore store, PasswordHasher passwordHasher, AuthService authService,
            AuthorizationService authorizationService, ObjectMapper objectMapper, ContentTypeDirectory contentTypes,
            TransactionRunner transactions, AuditLog auditLog) {
        this.store = store;
        this.passwordHasher = passwordHasher;
        this.authService = authService;
        this.authorizationService = authorizationService;
        this.objectMapper = objectMapper;
        this.contentTypes = contentTypes;
        this.transactions = transactions;
        this.auditLog = auditLog;
    }

    public List<Principal> list(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listPrincipals(); }

    /**
     * Principals that can be assigned to entries of contentType (G-04): active, not deleted, and holding update on
     * that type on the Back surface (predicates ignored). The caller needs update on the type on its own surface.
     * q filters by username or displayName (case-insensitive substring). Ordered by displayName, then username; at
     * most 20.
     */
    public List<Principal> assignable(IdentityRequest request, String contentType, String q) {
        if (request.principal() == null) throw IdentityException.unauthenticated();
        if (contentType == null || contentType.isBlank()) throw IdentityException.validation("contentType is required");
        if (!contentTypes.enabledTypeKeys().contains(contentType)) throw IdentityException.validation("unknown contentType");
        if (!authorizationService.hasAction(request.principal(), CmsAction.UPDATE, contentType, request.surface())) {
            throw IdentityException.forbidden(CmsAction.UPDATE.wire(), contentType, request.surface().wire());
        }
        String needle = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        return store.listPrincipals().stream()
                .filter(p -> !p.deleted() && p.status() == PrincipalStatus.ACTIVE)
                .filter(p -> needle.isEmpty()
                        || p.username().toLowerCase(Locale.ROOT).contains(needle)
                        || (p.displayName() != null && p.displayName().toLowerCase(Locale.ROOT).contains(needle)))
                .filter(p -> authorizationService.hasAction(p, CmsAction.UPDATE, contentType, Surface.BACK))
                .sorted(Comparator.comparing((Principal p) -> p.displayName() == null ? "" : p.displayName().toLowerCase(Locale.ROOT))
                        .thenComparing(Principal::username))
                .limit(20)
                .toList();
    }

    public Principal get(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        return store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
    }

    public CreatedPrincipal create(IdentityRequest request, String username, String displayName, String email, String temporaryPassword) {
        authService.requireManagePrincipals(request);
        String normalized = username == null ? "" : username.toLowerCase(Locale.ROOT);
        if (!USERNAME.matcher(normalized).matches()) throw IdentityException.validation("username must match [a-z0-9._-]{3,32}");
        if (store.findPrincipalByUsername(normalized).isPresent()) throw IdentityException.validation("username is taken");
        validateProfile(null, displayName, email);
        String password = temporaryPassword;
        if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
        authService.validateNewPassword(normalized, password);
        Instant now = Instant.now();
        Principal principal = new Principal(UUID.randomUUID(), normalized,
                displayName == null || displayName.isBlank() ? normalized : displayName, email, PrincipalStatus.ACTIVE,
                0, null, null, now, now, null);
        String hash = passwordHasher.hash(password);
        transactions.run(() -> {
            store.insertPrincipal(principal);
            store.upsertPasswordCredential(principal.id(), hash, passwordHasher.algo());
            audit(request, "PRINCIPAL_CREATED", principal.id());
        });
        return new CreatedPrincipal(principal, password);
    }

    public Principal patch(IdentityRequest request, UUID id, String displayName, String email, String status) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        validateProfile(id, displayName, email);
        Instant now = Instant.now();
        PrincipalStatus nextStatus = status == null ? current.status() : parseStatus(status);
        Principal updated = current.withProfile(displayName == null ? current.displayName() : displayName,
                email == null ? current.email() : email, now);
        if (nextStatus != current.status()) updated = updated.withStatus(nextStatus, now);
        boolean removesUsableAdmin = current.status() == PrincipalStatus.ACTIVE && nextStatus != PrincipalStatus.ACTIVE;
        Principal next = updated;
        return transactions.inTransaction(() -> {
            Principal saved = removesUsableAdmin ? store.updatePrincipalKeepingUsableAdmin(next) : store.updatePrincipal(next);
            if (nextStatus == PrincipalStatus.DISABLED && current.status() != PrincipalStatus.DISABLED) {
                store.revokeAllForPrincipal(id, now, null);
                audit(request, "PRINCIPAL_DISABLED", id);
            }
            return saved;
        });
    }

    public Principal disable(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        return transactions.inTransaction(() -> {
            Principal updated = store.updatePrincipalKeepingUsableAdmin(current.withStatus(PrincipalStatus.DISABLED, Instant.now()));
            store.revokeAllForPrincipal(id, Instant.now(), null);
            audit(request, "PRINCIPAL_DISABLED", id);
            return updated;
        });
    }

    public Principal unlock(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        if (current.status() == PrincipalStatus.DISABLED) throw IdentityException.accountDisabled();
        Principal updated = current.withLock(0, null, PrincipalStatus.ACTIVE, Instant.now());
        return transactions.inTransaction(() -> store.updatePrincipal(updated));
    }

    public void replaceRoles(IdentityRequest request, UUID id, List<RoleAssignmentInput> inputs) {
        authService.requireManagePrincipals(request);
        store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        if (inputs == null) throw IdentityException.validation("roles are required");
        Set<String> seen = new HashSet<>();
        List<PrincipalRoleAssignment> assignments = new ArrayList<>();
        for (RoleAssignmentInput input : inputs) {
            if (input == null || input.code() == null || input.code().isBlank()) throw IdentityException.validation("role code is required");
            if (!seen.add(input.code())) throw IdentityException.validation("duplicate role: " + input.code());
            Role role = store.findRoleByCode(input.code()).orElseThrow(() -> IdentityException.validation("unknown role"));
            List<String> allowlist = input.contentTypeCodes() == null ? List.of() : input.contentTypeCodes().stream().distinct().toList();
            if ((RoleCode.EDITOR.wire().equals(role.code()) || RoleCode.OPERATOR.wire().equals(role.code())) && allowlist.isEmpty()) {
                throw IdentityException.validation("editor/operator require an explicit content type allowlist");
            }
            assignments.add(new PrincipalRoleAssignment(id, role.id(), role.code(), allowlist));
        }
        transactions.run(() -> {
            store.replacePrincipalRolesKeepingUsableAdmin(id, assignments);
            audit(request, "ROLE_ASSIGNED", id);
        });
    }

    public String setPassword(IdentityRequest request, UUID id, String temporaryPassword) {
        authService.requireManagePrincipals(request);
        Principal principal = store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        String password = temporaryPassword;
        if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
        authService.validateNewPassword(principal.username(), password);
        String hash = passwordHasher.hash(password);
        transactions.run(() -> {
            store.upsertPasswordCredential(id, hash, passwordHasher.algo());
            store.revokeAllForPrincipal(id, Instant.now(), null);
            audit(request, "PASSWORD_SET_BY_ADMIN", id);
        });
        return password;
    }

    public List<Role> listRoles(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listRoles(); }

    public List<Permission> rolePermissions(IdentityRequest request, String code) {
        authService.requireManagePrincipals(request);
        Role role = store.findRoleByCode(code).orElseThrow(() -> IdentityException.validation("unknown role"));
        return store.permissionsOfRole(role.id());
    }

    public void replaceRolePermissions(IdentityRequest request, String code, List<Permission> permissions) {
        authService.requireManagePrincipals(request);
        Role role = store.findRoleByCode(code).orElseThrow(() -> IdentityException.validation("unknown role"));
        if (permissions == null) throw IdentityException.validation("permissions are required");
        if (role.system() && RoleCode.ANONYMOUS.wire().equals(role.code()) && permissions.isEmpty()) {
            throw IdentityException.validation("cannot empty anonymous grants accidentally");
        }
        Instant now = Instant.now();
        Set<String> seen = new HashSet<>();
        List<Permission> next = new ArrayList<>();
        for (Permission p : permissions) {
            CmsAction action;
            try { action = CmsAction.fromWire(p.action()); } catch (IllegalArgumentException e) { throw IdentityException.validation(e.getMessage()); }
            List<String> surfaces = p.allowedSurfaces() == null || p.allowedSurfaces().isEmpty() ? defaultSurfaces(action.wire()) : p.allowedSurfaces().stream().distinct().toList();
            if (surfaces.stream().anyMatch(s -> !SURFACES.contains(s))) throw IdentityException.validation("unknown surface");
            if (p.contentTypeCode() != null && p.contentTypeCode().codePointCount(0, p.contentTypeCode().length()) > 64) {
                throw IdentityException.validation("contentTypeCode must be at most 64 characters");
            }
            validatePredicate(p.predicateJson());
            String predicateProblem = PredicateIndexCheck.problem(objectMapper, contentTypes, p.contentTypeCode(), p.predicateJson());
            if (predicateProblem != null) throw IdentityException.validation(predicateProblem);
            String key = action.wire() + "|" + (p.contentTypeCode() == null ? "" : p.contentTypeCode()) + "|" + (p.predicateJson() == null ? "" : p.predicateJson()) + "|" + surfaces;
            if (!seen.add(key)) throw IdentityException.validation("duplicate permission");
            next.add(new Permission(UUID.randomUUID(), role.id(), action.wire(), p.contentTypeCode(), p.predicateJson(), surfaces, now));
        }
        transactions.run(() -> {
            store.replaceRolePermissionsKeepingUsableAdmin(role.id(), next);
            auditLog.record(request.principal(), request.surface(), "AUTH", "role.permissions_update", "role", role.id(),
                    AuditLog.OK, java.util.Map.of("roleCode", role.code(), "permissions", next.size()));
        });
    }

    public List<java.util.Map<String, Object>> effective(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        store.findPrincipalById(id).orElseThrow(IdentityException::principalNotFound);
        return authorizationService.effectivePermissions(id);
    }

    /** Database column limits count Unicode code points; another principal's email is case-insensitively unique. */
    private void validateProfile(UUID self, String displayName, String email) {
        if (displayName != null && displayName.codePointCount(0, displayName.length()) > 80) {
            throw IdentityException.validation("displayName must be at most 80 characters");
        }
        if (email == null) return;
        if (email.codePointCount(0, email.length()) > 254) {
            throw IdentityException.validation("email must be at most 254 characters");
        }
        boolean taken = store.listPrincipals().stream()
                .anyMatch(p -> !p.id().equals(self) && p.email() != null && p.email().equalsIgnoreCase(email));
        if (taken) throw IdentityException.validation("email is taken");
    }

    private void validatePredicate(String predicateJson) {
        if (predicateJson == null || predicateJson.isBlank()) return;
        try {
            JsonNode node = objectMapper.readTree(predicateJson);
            if (!"fieldEquals".equals(node.path("type").asText()) || node.path("field").asText().isBlank() || node.path("value").asText().isBlank()) {
                throw IdentityException.validation("unsupported or malformed predicate");
            }
        } catch (IdentityException e) {
            throw e;
        } catch (Exception e) {
            throw IdentityException.validation("malformed predicate JSON");
        }
    }

    private static List<String> defaultSurfaces(String action) {
        CmsAction parsed = CmsAction.fromWire(action);
        if (parsed == CmsAction.READ_PUBLISHED) return List.of(Surface.FRONT.wire(), Surface.BACK.wire(), Surface.ADMIN.wire());
        if (CmsAction.GOVERNANCE.contains(parsed)) return List.of(Surface.ADMIN.wire());
        return List.of(Surface.BACK.wire(), Surface.ADMIN.wire());
    }

    private void audit(IdentityRequest request, String action, UUID targetId) {
        store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), request.principal() == null ? null : request.principal().id(),
                "AUTH", action, "principal", targetId, request.surface().wire(), "ok", request.ip(), null));
    }

    private static PrincipalStatus parseStatus(String status) {
        try {
            return PrincipalStatus.fromWire(status);
        } catch (IllegalArgumentException e) {
            throw IdentityException.validation("unknown status");
        }
    }
}
