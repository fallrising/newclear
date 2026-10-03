package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.Capabilities;
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
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class AuthorizationService {

    /** Per-content-type actions reported by capabilities(), in this order. */
    public static final List<CmsAction> TYPE_ACTIONS = List.of(
            CmsAction.READ_PUBLISHED, CmsAction.READ_DRAFT, CmsAction.CREATE, CmsAction.UPDATE,
            CmsAction.PUBLISH, CmsAction.UNPUBLISH, CmsAction.DELETE, CmsAction.ARCHIVE);

    /** Global actions reported by capabilities(), in this order. */
    public static final List<CmsAction> GLOBAL_ACTIONS = List.of(
            CmsAction.MANAGE_MEDIA, CmsAction.MANAGE_TYPES, CmsAction.MANAGE_PRINCIPALS,
            CmsAction.MANAGE_SETTINGS, CmsAction.READ_AUDIT);

    static final String GRANT_CACHE_PREFIX = AuthorizationService.class.getName() + ".grants:";
    private static final String ROLE_CACHE_PREFIX = AuthorizationService.class.getName() + ".roles:";

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

    /**
     * Capabilities of the principal on the surface (02 §4.2). Hard-deny sets are applied first; an action is listed
     * when at least one grant matches it ignoring predicates; scoped is true when every matching grant of some listed
     * action carries a predicate.
     */
    public Capabilities capabilities(Principal principal, Surface surface, List<String> enabledTypeKeys) {
        Surface resolved = surface == null ? Surface.FRONT : surface;
        List<Grant> grants = collectGrants(principal);
        List<Capabilities.TypeCapability> types = new ArrayList<>();
        for (String typeKey : enabledTypeKeys) {
            List<String> actions = new ArrayList<>();
            boolean scoped = false;
            for (CmsAction action : TYPE_ACTIONS) {
                if (hardDenied(resolved, action)) continue;
                List<Grant> matching = grants.stream().filter(g -> matchesGrant(g, action, typeKey, resolved)).toList();
                if (matching.isEmpty()) continue;
                actions.add(action.wire());
                if (matching.stream().allMatch(g -> g.permission.predicateJson() != null && !g.permission.predicateJson().isBlank())) {
                    scoped = true;
                }
            }
            if (!actions.isEmpty()) types.add(new Capabilities.TypeCapability(typeKey, List.copyOf(actions), scoped));
        }
        List<String> global = new ArrayList<>();
        for (CmsAction action : GLOBAL_ACTIONS) {
            if (hardDenied(resolved, action)) continue;
            if (grants.stream().anyMatch(g -> matchesGrant(g, action, null, resolved))) global.add(action.wire());
        }
        return new Capabilities(resolved.wire(), List.copyOf(types), List.copyOf(global));
    }

    private static boolean hardDenied(Surface surface, CmsAction action) {
        return (surface == Surface.FRONT && CmsAction.FRONT_HARD_DENY.contains(action))
                || (surface == Surface.BACK && CmsAction.BACK_HARD_DENY.contains(action));
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

    /**
     * Grants of the principal plus anonymous grants. Inside an HTTP request the result is cached as a request
     * attribute, so one request reads roles and permissions from the store once per principal (B-12).
     * Outside a request (seeders, unit tests) nothing is cached.
     */
    @SuppressWarnings("unchecked")
    private List<Grant> collectGrants(Principal principal) {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        String key = GRANT_CACHE_PREFIX + (principal == null ? "anonymous" : principal.id());
        if (request != null) {
            Object cached = request.getAttribute(key, RequestAttributes.SCOPE_REQUEST);
            if (cached != null) return (List<Grant>) cached;
        }
        List<Grant> grants = loadGrants(principal);
        if (request != null) request.setAttribute(key, grants, RequestAttributes.SCOPE_REQUEST);
        return grants;
    }

    /** Shares role assignments with AuthService's me projection for this request only. */
    @SuppressWarnings("unchecked")
    List<PrincipalRoleAssignment> rolesOf(UUID principalId) {
        RequestAttributes request = RequestContextHolder.getRequestAttributes();
        String key = ROLE_CACHE_PREFIX + principalId;
        if (request != null) {
            Object cached = request.getAttribute(key, RequestAttributes.SCOPE_REQUEST);
            if (cached != null) return (List<PrincipalRoleAssignment>) cached;
        }
        List<PrincipalRoleAssignment> roles = List.copyOf(store.rolesOf(principalId));
        if (request != null) request.setAttribute(key, roles, RequestAttributes.SCOPE_REQUEST);
        return roles;
    }

    private List<Grant> loadGrants(Principal principal) {
        List<Grant> grants = new ArrayList<>();
        Optional<Role> anonymous = store.findRoleByCode(RoleCode.ANONYMOUS.wire());
        anonymous.ifPresent(role -> store.permissionsOfRole(role.id()).forEach(permission -> grants.add(new Grant(RoleCode.ANONYMOUS.wire(), Set.of(), permission))));
        if (principal == null) return List.copyOf(grants);
        for (PrincipalRoleAssignment assignment : rolesOf(principal.id())) {
            Set<String> allowlist = Set.copyOf(assignment.contentTypeCodes());
            for (Permission permission : store.permissionsOfRole(assignment.roleId())) grants.add(new Grant(assignment.roleCode(), allowlist, permission));
        }
        return List.copyOf(grants);
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
