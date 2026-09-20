package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Credential;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AuthService {

    public record LoginResult(Principal principal, String sessionToken, String csrfToken) {}
    public record MeResult(Principal principal, List<PrincipalRoleAssignment> roles, Map<String, Boolean> surfaces) {}

    private final IdentityStore store;
    private final PasswordHasher passwordHasher;
    private final IdentityProperties properties;
    private final AuthorizationService authorizationService;

    public AuthService(IdentityStore store, PasswordHasher passwordHasher, IdentityProperties properties,
            AuthorizationService authorizationService) {
        this.store = store;
        this.passwordHasher = passwordHasher;
        this.properties = properties;
        this.authorizationService = authorizationService;
    }

    public LoginResult login(String username, String password, IdentityRequest request) {
        if (request.origin() != null && !request.origin().isBlank() && !properties.originAllowed(request.origin())) {
            throw IdentityException.csrfFailed();
        }
        Instant now = Instant.now();
        Principal principal = store.findPrincipalByUsername(username == null ? "" : username).orElse(null);
        Credential credential = principal == null ? null : store.findPasswordCredential(principal.id()).orElse(null);
        String hash = credential == null ? passwordHasher.dummyHash() : credential.secretHash();
        boolean matches = passwordHasher.matches(password == null ? "" : password, hash);

        if (principal == null || credential == null || !matches) {
            if (principal != null && credential != null && principal.status() != PrincipalStatus.DISABLED) {
                registerFailure(principal, now);
            }
            audit(principal == null ? null : principal.id(), "LOGIN_FAILURE", request, "denied", null);
            throw IdentityException.invalidCredentials();
        }

        if (principal.status() == PrincipalStatus.DISABLED) {
            audit(principal.id(), "LOGIN_FAILURE", request, "denied", "{\"reason\":\"disabled\"}");
            throw IdentityException.accountDisabled();
        }
        if (isLocked(principal, now)) {
            audit(principal.id(), "LOGIN_FAILURE", request, "denied", "{\"reason\":\"locked\"}");
            throw IdentityException.accountLocked();
        }

        Principal unlocked = principal.withLoginSuccess(now);
        store.updatePrincipal(unlocked);
        store.revokeAllForPrincipal(unlocked.id(), now, null);

        String token = SessionTokens.randomToken();
        SessionRecord session = new SessionRecord(UUID.randomUUID(), unlocked.id(), SessionTokens.sha256(token), now,
                now.plus(properties.getSessionAbsolute()), now, null, request.surface().wire(), truncate(request.ip()),
                truncate(request.userAgent()));
        store.insertSession(session);
        audit(unlocked.id(), "LOGIN_SUCCESS", request, "ok", null);
        return new LoginResult(unlocked, token, SessionTokens.randomToken());
    }

    public void logout(IdentityRequest request) {
        if (request.session() == null) throw IdentityException.unauthenticated();
        Instant now = Instant.now();
        store.revokeSession(request.session().id(), now);
        audit(request.principal().id(), "LOGOUT", request, "ok", null);
    }

    public MeResult me(IdentityRequest request) {
        if (request.principal() == null) {
            if (request.tokenState() == IdentityRequest.TokenState.EXPIRED || request.tokenState() == IdentityRequest.TokenState.REVOKED) {
                throw IdentityException.sessionExpired();
            }
            throw IdentityException.unauthenticated();
        }
        return toMe(request.principal());
    }

    public MeResult toMe(Principal principal) {
        List<PrincipalRoleAssignment> roles = store.rolesOf(principal.id());
        boolean admin = roles.stream().anyMatch(r -> RoleCode.ADMIN.wire().equals(r.roleCode()));
        boolean staff = admin || roles.stream().anyMatch(r -> RoleCode.EDITOR.wire().equals(r.roleCode()) || RoleCode.OPERATOR.wire().equals(r.roleCode()));
        return new MeResult(principal, roles, Map.of("front", true, "back", staff, "admin", admin));
    }

    public void changePassword(IdentityRequest request, String currentPassword, String newPassword) {
        Principal principal = request.principal();
        if (principal == null) throw IdentityException.unauthenticated();
        Credential credential = store.findPasswordCredential(principal.id()).orElseThrow(IdentityException::unauthenticated);
        if (!passwordHasher.matches(currentPassword == null ? "" : currentPassword, credential.secretHash())) throw IdentityException.invalidCredentials();
        validateNewPassword(principal.username(), newPassword);
        store.upsertPasswordCredential(principal.id(), passwordHasher.hash(newPassword), passwordHasher.algo());
        store.revokeAllForPrincipal(principal.id(), Instant.now(), null);
        audit(principal.id(), "PASSWORD_CHANGED", request, "ok", null);
    }

    public void validateNewPassword(String username, String newPassword) {
        if (newPassword == null || newPassword.length() < 12) throw IdentityException.validation("Password must be at least 12 characters");
        if (username != null && newPassword.equalsIgnoreCase(username)) throw IdentityException.validation("Password must not equal username");
    }

    public void requireManagePrincipals(IdentityRequest request) {
        if (request.principal() == null) throw IdentityException.unauthenticated();
        authorizationService.require(request.principal(), CmsAction.MANAGE_PRINCIPALS, null, null, request.surface());
    }

    public SessionRecord touch(SessionRecord session, Instant now) {
        Instant max = session.createdAt().plus(properties.getSessionMax());
        Instant slid = now.plus(properties.getSessionAbsolute());
        Instant expires = slid.isAfter(max) ? max : slid;
        if (!store.touchSession(session.id(), now, expires, now)) {
            throw IdentityException.sessionExpired();
        }
        return session.seen(now, expires);
    }

    private boolean isLocked(Principal principal, Instant now) {
        if (principal.status() == PrincipalStatus.LOCKED && principal.lockedUntil() != null && principal.lockedUntil().isAfter(now)) return true;
        return principal.lockedUntil() != null && principal.lockedUntil().isAfter(now);
    }

    private void registerFailure(Principal principal, Instant now) {
        int failures = principal.failedLoginCount() + 1;
        if (failures >= properties.getLockoutThreshold()) {
            store.updatePrincipal(principal.withLock(failures, now.plus(properties.getLockoutDuration()), PrincipalStatus.LOCKED, now));
        } else {
            store.updatePrincipal(principal.withLock(failures, principal.lockedUntil(), principal.status(), now));
        }
    }

    private void audit(UUID actor, String action, IdentityRequest request, String outcome, String detail) {
        store.insertAudit(new AuditEvent(UUID.randomUUID(), Instant.now(), actor, "AUTH", action, "principal", actor,
                request.surface().wire(), outcome, truncate(request.ip()), detail));
    }

    private static String truncate(String value) {
        if (value == null) return null;
        return value.length() <= 240 ? value : value.substring(0, 240);
    }
}
