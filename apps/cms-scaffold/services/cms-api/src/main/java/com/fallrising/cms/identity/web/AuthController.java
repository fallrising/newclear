package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    public record LoginBody(@NotBlank String username, @NotBlank String password, String surface) {}

    public record PasswordChangeBody(@NotBlank String currentPassword, @NotBlank String newPassword) {}

    public record CsrfBody(String csrfToken) {}

    private final AuthService authService;
    private final CookieSupport cookies;

    public AuthController(AuthService authService, CookieSupport cookies) {
        this.authService = authService;
        this.cookies = cookies;
    }

    @PostMapping("/login")
    public Map<String, Object> login(
            @Valid @RequestBody LoginBody body, HttpServletRequest request, HttpServletResponse response) {
        IdentityRequest identity = current(request);
        AuthService.LoginResult result = authService.login(body.username(), body.password(), identity);
        cookies.setSession(response, result.sessionToken());
        cookies.setCsrf(response, result.csrfToken());
        Map<String, Object> payload = mePayload(authService.toMe(result.principal()));
        payload.put("csrfToken", result.csrfToken());
        return payload;
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        authService.logout(current(request));
        cookies.clearSession(response);
        cookies.clearCsrf(response);
    }

    @GetMapping("/me")
    public Map<String, Object> me(HttpServletRequest request) {
        return mePayload(authService.me(current(request)));
    }

    @GetMapping("/csrf")
    public CsrfBody csrf(HttpServletResponse response) {
        String token = SessionTokens.randomToken();
        cookies.setCsrf(response, token);
        return new CsrfBody(token);
    }

    @PostMapping("/password/change")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(@RequestBody PasswordChangeBody body, HttpServletRequest request, HttpServletResponse response) {
        authService.changePassword(current(request), body.currentPassword(), body.newPassword());
        cookies.clearSession(response);
        cookies.clearCsrf(response);
    }

    public static IdentityRequest current(HttpServletRequest request) {
        return (IdentityRequest) request.getAttribute(IdentityErrorWriter.ATTR);
    }

    static Map<String, Object> mePayload(AuthService.MeResult me) {
        Principal principal = me.principal();
        Map<String, Object> principalJson = new LinkedHashMap<>();
        principalJson.put("id", principal.id().toString());
        principalJson.put("username", principal.username());
        principalJson.put("displayName", principal.displayName());
        principalJson.put("status", principal.status().wire());
        List<Map<String, Object>> roles = me.roles().stream().map(AuthController::roleJson).toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("principal", principalJson);
        body.put("roles", roles);
        body.put("surfaces", me.surfaces());
        return body;
    }

    private static Map<String, Object> roleJson(PrincipalRoleAssignment assignment) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("code", assignment.roleCode());
        json.put("contentTypeCodes", assignment.contentTypeCodes());
        return json;
    }
}
