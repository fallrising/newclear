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
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
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

    public PrincipalAdminService(IdentityStore store, PasswordHasher passwordHasher, AuthService authService,
            AuthorizationService authorizationService, ObjectMapper objectMapper) {
        this.store = store;
        this.passwordHasher = passwordHasher;
        this.authService = authService;
        this.authorizationService = authorizationService;
        this.objectMapper = objectMapper;
    }

    public List<Principal> list(IdentityRequest request) { authService.requireManagePrincipals(request); return store.listPrincipals(); }

    public Principal get(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        return store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
    }

    public CreatedPrincipal create(IdentityRequest request, String username, String displayName, String email, String temporaryPassword) {
        authService.requireManagePrincipals(request);
        String normalized = username == null ? "" : username.toLowerCase(Locale.ROOT);
        if (!USERNAME.matcher(normalized).matches()) throw IdentityException.validation("username must match [a-z0-9._-]{3,32}");
        if (store.findPrincipalByUsername(normalized).isPresent()) throw IdentityException.validation("username is taken");
        String password = temporaryPassword;
        if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
        authService.validateNewPassword(normalized, password);
        Instant now = Instant.now();
        Principal principal = new Principal(UUID.randomUUID(), normalized,
                displayName == null || displayName.isBlank() ? normalized : displayName, email, PrincipalStatus.ACTIVE,
                0, null, null, now, now, null);
        store.insertPrincipal(principal);
        store.upsertPasswordCredential(principal.id(), passwordHasher.hash(password), passwordHasher.algo());
        audit(request, "PRINCIPAL_CREATED", principal.id());
        return new CreatedPrincipal(principal, password);
    }

    public Principal patch(IdentityRequest request, UUID id, String displayName, String email, String status) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
        Instant now = Instant.now();
        PrincipalStatus nextStatus = status == null ? current.status() : parseStatus(status);
        Principal updated = current.withProfile(displayName == null ? current.displayName() : displayName,
                email == null ? current.email() : email, now);
        if (nextStatus != current.status()) updated = updated.withStatus(nextStatus, now);
        boolean removesUsableAdmin = current.status() == PrincipalStatus.ACTIVE && nextStatus != PrincipalStatus.ACTIVE;
        updated = removesUsableAdmin ? store.updatePrincipalKeepingUsableAdmin(updated) : store.updatePrincipal(updated);
        if (nextStatus == PrincipalStatus.DISABLED && current.status() != PrincipalStatus.DISABLED) {
            store.revokeAllForPrincipal(id, now, null);
            audit(request, "PRINCIPAL_DISABLED", id);
        }
        return updated;
    }

    public Principal disable(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
        Principal updated = store.updatePrincipalKeepingUsableAdmin(current.withStatus(PrincipalStatus.DISABLED, Instant.now()));
        store.revokeAllForPrincipal(id, Instant.now(), null);
        audit(request, "PRINCIPAL_DISABLED", id);
        return updated;
    }

    public Principal unlock(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        Principal current = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
        if (current.status() == PrincipalStatus.DISABLED) throw IdentityException.accountDisabled();
        Principal updated = current.withLock(0, null, PrincipalStatus.ACTIVE, Instant.now());
        store.updatePrincipal(updated);
        return updated;
    }

    public void replaceRoles(IdentityRequest request, UUID id, List<RoleAssignmentInput> inputs) {
        authService.requireManagePrincipals(request);
        store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
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
        store.replacePrincipalRolesKeepingUsableAdmin(id, assignments);
        audit(request, "ROLE_ASSIGNED", id);
    }

    public String setPassword(IdentityRequest request, UUID id, String temporaryPassword) {
        authService.requireManagePrincipals(request);
        Principal principal = store.findPrincipalById(id).orElseThrow(() -> IdentityException.validation("not found"));
        String password = temporaryPassword;
        if (password == null || password.isBlank()) password = SessionTokens.randomToken() + "Aa1";
        authService.validateNewPassword(principal.username(), password);
        store.upsertPasswordCredential(id, passwordHasher.hash(password), passwordHasher.algo());
        store.revokeAllForPrincipal(id, Instant.now(), null);
        audit(request, "PASSWORD_SET_BY_ADMIN", id);
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
            validatePredicate(p.predicateJson());
            String key = action.wire() + "|" + (p.contentTypeCode() == null ? "" : p.contentTypeCode()) + "|" + (p.predicateJson() == null ? "" : p.predicateJson()) + "|" + surfaces;
            if (!seen.add(key)) throw IdentityException.validation("duplicate permission");
            next.add(new Permission(UUID.randomUUID(), role.id(), action.wire(), p.contentTypeCode(), p.predicateJson(), surfaces, now));
        }
        store.replaceRolePermissionsKeepingUsableAdmin(role.id(), next);
        audit(request, "PERMISSION_CHANGED", role.id());
    }

    public List<java.util.Map<String, Object>> effective(IdentityRequest request, UUID id) {
        authService.requireManagePrincipals(request);
        return authorizationService.effectivePermissions(id);
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
