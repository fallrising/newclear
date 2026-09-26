package com.fallrising.cms.identity;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class IdentityException extends CmsApiException {

    public IdentityException(ErrorCode code, String message, String action, String contentType, String surface) {
        super(code, message, action, contentType, surface);
    }

    public static IdentityException unauthenticated() {
        return new IdentityException(ErrorCode.UNAUTHENTICATED, "Authentication required", null, null, null);
    }

    public static IdentityException invalidCredentials() {
        return new IdentityException(ErrorCode.INVALID_CREDENTIALS,
                "Invalid username or password",
                null,
                null,
                null);
    }

    public static IdentityException sessionExpired() {
        return new IdentityException(ErrorCode.SESSION_EXPIRED, "Session expired or revoked", null, null, null);
    }

    public static IdentityException accountDisabled() {
        return new IdentityException(ErrorCode.ACCOUNT_DISABLED, "Account is disabled", null, null, null);
    }

    public static IdentityException accountLocked() {
        return new IdentityException(ErrorCode.ACCOUNT_LOCKED, "Account is locked", null, null, null);
    }

    public static IdentityException csrfFailed() {
        return new IdentityException(ErrorCode.CSRF_FAILED, "CSRF validation failed", null, null, null);
    }

    public static IdentityException forbidden(String action, String contentType, String surface) {
        return new IdentityException(ErrorCode.FORBIDDEN,
                "Missing permission " + action + (contentType == null ? "" : " on content type " + contentType),
                action,
                contentType,
                surface);
    }

    public static IdentityException surfaceForbidden(String action, String contentType, String surface) {
        return new IdentityException(ErrorCode.SURFACE_FORBIDDEN,
                "Action " + action + " is not allowed on surface " + surface,
                action,
                contentType,
                surface);
    }

    public static IdentityException lastAdmin() {
        return new IdentityException(ErrorCode.LAST_ADMIN,
                "Cannot disable the last active admin",
                "manage_principals",
                null,
                "admin");
    }

    public static IdentityException validation(String message) {
        return new IdentityException(ErrorCode.VALIDATION_FAILED, message, null, null, null);
    }
}
