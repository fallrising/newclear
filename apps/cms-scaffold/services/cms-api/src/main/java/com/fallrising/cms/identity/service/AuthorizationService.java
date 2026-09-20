package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class AuthorizationService {

    public enum DecisionKind { ALLOW, FORBIDDEN, SURFACE_FORBIDDEN }
    public record Decision(DecisionKind kind, CmsAction action, String contentType, Surface surface) {
        public boolean allowed() { return kind == DecisionKind.ALLOW; }
    }

    private final IdentityStore store;
    private final ObjectMapper objectMapper;

    public AuthorizationService(IdentityStore store, ObjectMapper objectMapper) {
        this.store = store;
        this.objectMapper = objectMapper;
    }

    public void require(Principal principal, CmsAction action, String contentType, Map<String, Object> entry, Surface surface) {
        Decision decision = allow(principal, action, contentType, entry, surface);
        if (decision.kind() == DecisionKind.SURFACE_FORBIDDEN) throw IdentityException.surfaceForbidden(action.wire(), contentType, surface.wire());
        if (decision.kind() == DecisionKind.FORBIDDEN) throw IdentityException.forbidden(action.wire(), contentType, surface.wire());
    }

    public Decision allow(Principal principal, CmsAction action, String contentType, Map<String, Object> entry, Surface surface) {
        Surface resolved = surface == null ? Surface.FRONT : surface;
        if (resolved == Surface.FRONT && CmsAction.FRONT_HARD_DENY.contains(action)) return new Decision(DecisionKind.SURFACE_FORBIDDEN, action, contentType, resolved);
        if (resolved == Surface.BACK && CmsAction.BACK_HARD_DENY.contains(action)) return new Decision(DecisionKind.SURFACE_FORBIDDEN, action, contentType, resolved);
        for (Grant grant : collectGrants(principal)) {
            if (matches(grant, principal, action, contentType, entry, resolved)) return new Decision(DecisionKind.ALLOW, action, contentType, resolved);
        }
        return new Decision(DecisionKind.FORBIDDEN, action, contentType, resolved);
    }

    public boolean hasAction(Principal principal, CmsAction action, String contentType, Surface surface) {
        Surface resolved = surface == null ? Surface.FRONT : surface;
        if (resolved == Surface.FRONT && CmsAction.FRONT_HARD_DENY.contains(action)) return false;
        if (resolved == Surface.BACK && CmsAction.BACK_HARD_DENY.contains(action)) return false;
        for (Grant grant : collectGrants(principal)) {
            if (matchesGrant(grant, action, contentType, resolved)) return true;
        }
        return false;
    }

    private boolean matches(Grant grant, Principal principal, CmsAction action, String contentType, Map<String, Object> entry, Surface surface) {
        return matchesGrant(grant, action, contentType, surface)
                && predicateAllows(grant.permission.predicateJson(), principal, entry);
    }

    private boolean matchesGrant(Grant grant, CmsAction action, String contentType, Surface surface) {
        if (!grant.permission.action().equals(action.wire())) return false;
        if (!grant.permission.allowedSurfaces().contains(surface.wire())) return false;
        boolean globalAction = CmsAction.GLOBAL.contains(action);
        if (globalAction) return grant.permission.contentTypeCode() == null || grant.permission.contentTypeCode().isBlank();
        if (RoleCode.EDITOR.wire().equals(grant.roleCode) || RoleCode.OPERATOR.wire().equals(grant.roleCode)) {
            if (grant.allowlist.isEmpty()) return false;
            if (contentType == null || !grant.allowlist.contains(contentType)) return false;
            if (grant.permission.contentTypeCode() != null && !grant.permission.contentTypeCode().isBlank() && !grant.permission.contentTypeCode().equals(contentType)) return false;
        } else if (grant.permission.contentTypeCode() != null && !grant.permission.contentTypeCode().isBlank()) {
            if (contentType == null || !grant.permission.contentTypeCode().equals(contentType)) return false;
        }
        return true;
    }

    private boolean predicateAllows(String predicateJson, Principal principal, Map<String, Object> entry) {
        if (predicateJson == null || predicateJson.isBlank()) return true;
        if (entry == null) return false;
        try {
            JsonNode node = objectMapper.readTree(predicateJson);
            if (!"fieldEquals".equals(node.path("type").asText())) return false;
            String field = node.path("field").asText();
            String expected = node.path("value").asText();
            if (field.isBlank() || expected.isBlank()) return false;
            if ("$currentPrincipalId".equals(expected)) expected = principal == null ? "" : principal.id().toString();
            Object actual = entry.get(field);
            return actual != null && expected.equals(String.valueOf(actual));
        } catch (Exception e) {
            return false;
        }
    }

    private List<Grant> collectGrants(Principal principal) {
        List<Grant> grants = new ArrayList<>();
        Optional<Role> anonymous = store.findRoleByCode(RoleCode.ANONYMOUS.wire());
        anonymous.ifPresent(role -> store.permissionsOfRole(role.id()).forEach(permission -> grants.add(new Grant(RoleCode.ANONYMOUS.wire(), Set.of(), permission))));
        if (principal == null) return grants;
        for (PrincipalRoleAssignment assignment : store.rolesOf(principal.id())) {
            Set<String> allowlist = new HashSet<>(assignment.contentTypeCodes());
            for (Permission permission : store.permissionsOfRole(assignment.roleId())) grants.add(new Grant(assignment.roleCode(), allowlist, permission));
        }
        return grants;
    }

    public List<Map<String, Object>> effectivePermissions(UUID principalId) {
        Principal principal = store.findPrincipalById(principalId).orElse(null);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Grant grant : collectGrants(principal)) {
            out.add(Map.of("role", grant.roleCode, "action", grant.permission.action(), "contentType",
                    grant.permission.contentTypeCode() == null ? "" : grant.permission.contentTypeCode(),
                    "allowedSurfaces", grant.permission.allowedSurfaces(), "allowlist", List.copyOf(grant.allowlist)));
        }
        return out;
    }

    private record Grant(String roleCode, Set<String> allowlist, Permission permission) {}
}
