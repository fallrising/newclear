package com.fallrising.cms.identity;

import com.fallrising.cms.identity.domain.AuthErrorCode;
import org.springframework.http.HttpStatus;

public class IdentityException extends RuntimeException {

    private final HttpStatus status;
    private final AuthErrorCode code;
    private final String action;
    private final String contentType;
    private final String surface;

    public IdentityException(
            HttpStatus status,
            AuthErrorCode code,
            String message,
            String action,
            String contentType,
            String surface) {
        super(message);
        this.status = status;
        this.code = code;
        this.action = action;
        this.contentType = contentType;
        this.surface = surface;
    }

    public HttpStatus status() {
        return status;
    }

    public AuthErrorCode code() {
        return code;
    }

    public String action() {
        return action;
    }

    public String contentType() {
        return contentType;
    }

    public String surface() {
        return surface;
    }

    public static IdentityException unauthenticated() {
        return new IdentityException(
                HttpStatus.UNAUTHORIZED, AuthErrorCode.UNAUTHENTICATED, "Authentication required", null, null, null);
    }

    public static IdentityException invalidCredentials() {
        return new IdentityException(
                HttpStatus.UNAUTHORIZED,
                AuthErrorCode.INVALID_CREDENTIALS,
                "Invalid username or password",
                null,
                null,
                null);
    }

    public static IdentityException sessionExpired() {
        return new IdentityException(
                HttpStatus.UNAUTHORIZED, AuthErrorCode.SESSION_EXPIRED, "Session expired or revoked", null, null, null);
    }

    public static IdentityException accountDisabled() {
        return new IdentityException(
                HttpStatus.FORBIDDEN, AuthErrorCode.ACCOUNT_DISABLED, "Account is disabled", null, null, null);
    }

    public static IdentityException accountLocked() {
        return new IdentityException(
                HttpStatus.FORBIDDEN, AuthErrorCode.ACCOUNT_LOCKED, "Account is locked", null, null, null);
    }

    public static IdentityException csrfFailed() {
        return new IdentityException(
                HttpStatus.FORBIDDEN, AuthErrorCode.CSRF_FAILED, "CSRF validation failed", null, null, null);
    }

    public static IdentityException forbidden(String action, String contentType, String surface) {
        return new IdentityException(
                HttpStatus.FORBIDDEN,
                AuthErrorCode.FORBIDDEN,
                "Missing permission " + action + (contentType == null ? "" : " on content type " + contentType),
                action,
                contentType,
                surface);
    }

    public static IdentityException surfaceForbidden(String action, String contentType, String surface) {
        return new IdentityException(
                HttpStatus.FORBIDDEN,
                AuthErrorCode.SURFACE_FORBIDDEN,
                "Action " + action + " is not allowed on surface " + surface,
                action,
                contentType,
                surface);
    }

    public static IdentityException lastAdmin() {
        return new IdentityException(
                HttpStatus.FORBIDDEN,
                AuthErrorCode.LAST_ADMIN,
                "Cannot disable the last active admin",
                "manage_principals",
                null,
                "admin");
    }

    public static IdentityException validation(String message) {
        return new IdentityException(
                HttpStatus.BAD_REQUEST, AuthErrorCode.VALIDATION_FAILED, message, null, null, null);
    }
}
