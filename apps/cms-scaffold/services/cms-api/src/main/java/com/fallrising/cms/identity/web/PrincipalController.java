package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.service.PrincipalAdminService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class PrincipalController {

    public record CreatePrincipalBody(String username, String displayName, String email, String temporaryPassword) {}

    public record PatchPrincipalBody(String displayName, String email, String status) {}

    public record RoleBody(@NotBlank String code, List<String> contentTypeCodes) {}

    public record PasswordBody(String temporaryPassword) {}

    public record PermissionBody(String action, String contentTypeCode, String predicateJson, List<String> allowedSurfaces) {}

    private final PrincipalAdminService principals;

    public PrincipalController(PrincipalAdminService principals) {
        this.principals = principals;
    }

    @GetMapping("/principals")
    public Map<String, Object> list(HttpServletRequest request) {
        List<Map<String, Object>> items =
                principals.list(AuthController.current(request)).stream().map(PrincipalController::principalJson).toList();
        return Map.of("items", items, "page", 0, "size", items.size(), "total", items.size());
    }

    @PostMapping("/principals")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody CreatePrincipalBody body, HttpServletRequest request) {
        PrincipalAdminService.CreatedPrincipal created = principals.create(
                AuthController.current(request), body.username(), body.displayName(), body.email(), body.temporaryPassword());
        Map<String, Object> json = principalJson(created.principal());
        json.put("temporaryPassword", created.temporaryPassword());
        return json;
    }

    @GetMapping("/principals/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        return principalJson(principals.get(AuthController.current(request), id));
    }

    @PatchMapping("/principals/{id}")
    public Map<String, Object> patch(
            @PathVariable UUID id, @RequestBody PatchPrincipalBody body, HttpServletRequest request) {
        return principalJson(principals.patch(
                AuthController.current(request), id, body.displayName(), body.email(), body.status()));
    }

    @PostMapping("/principals/{id}/disable")
    public Map<String, Object> disable(@PathVariable UUID id, HttpServletRequest request) {
        return principalJson(principals.disable(AuthController.current(request), id));
    }

    @PostMapping("/principals/{id}/unlock")
    public Map<String, Object> unlock(@PathVariable UUID id, HttpServletRequest request) {
        return principalJson(principals.unlock(AuthController.current(request), id));
    }

    @PutMapping("/principals/{id}/roles")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void roles(@PathVariable UUID id, @RequestBody List<RoleBody> body, HttpServletRequest request) {
        principals.replaceRoles(
                AuthController.current(request),
                id,
                body.stream()
                        .map(r -> new PrincipalAdminService.RoleAssignmentInput(
                                r.code(), r.contentTypeCodes() == null ? List.of() : r.contentTypeCodes()))
                        .toList());
    }

    @PostMapping("/principals/{id}/password")
    public Map<String, Object> password(
            @PathVariable UUID id, @RequestBody(required = false) PasswordBody body, HttpServletRequest request) {
        String temporary = principals.setPassword(
                AuthController.current(request), id, body == null ? null : body.temporaryPassword());
        return Map.of("temporaryPassword", temporary);
    }

    @GetMapping("/principals/{id}/effective-permissions")
    public Map<String, Object> effective(@PathVariable UUID id, HttpServletRequest request) {
        return Map.of("items", principals.effective(AuthController.current(request), id));
    }

    @GetMapping("/roles")
    public Map<String, Object> roles(HttpServletRequest request) {
        List<Map<String, Object>> items = principals.listRoles(AuthController.current(request)).stream()
                .map(PrincipalController::roleJson)
                .toList();
        return Map.of("items", items);
    }

    @GetMapping("/roles/{code}/permissions")
    public Map<String, Object> rolePermissions(@PathVariable String code, HttpServletRequest request) {
        List<Map<String, Object>> items = principals.rolePermissions(AuthController.current(request), code).stream()
                .map(PrincipalController::permissionJson)
                .toList();
        return Map.of("items", items);
    }

    @PutMapping("/roles/{code}/permissions")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void replacePermissions(
            @PathVariable String code, @RequestBody List<PermissionBody> body, HttpServletRequest request) {
        List<Permission> permissions = body.stream()
                .map(p -> new Permission(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        p.action(),
                        p.contentTypeCode(),
                        p.predicateJson(),
                        p.allowedSurfaces(),
                        java.time.Instant.now()))
                .toList();
        principals.replaceRolePermissions(AuthController.current(request), code, permissions);
    }

    private static Map<String, Object> principalJson(Principal principal) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", principal.id().toString());
        json.put("username", principal.username());
        json.put("displayName", principal.displayName());
        json.put("email", principal.email());
        json.put("status", principal.status().wire());
        return json;
    }

    private static Map<String, Object> roleJson(Role role) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("code", role.code());
        json.put("displayName", role.displayName());
        json.put("system", role.system());
        return json;
    }

    private static Map<String, Object> permissionJson(Permission permission) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", permission.id().toString());
        json.put("action", permission.action());
        json.put("contentTypeCode", permission.contentTypeCode());
        json.put("predicateJson", permission.predicateJson());
        json.put("allowedSurfaces", permission.allowedSurfaces());
        return json;
    }
}
