package com.fallrising.cms.identity.domain;

public enum AuthErrorCode {
    UNAUTHENTICATED,
    INVALID_CREDENTIALS,
    SESSION_EXPIRED,
    ACCOUNT_DISABLED,
    ACCOUNT_LOCKED,
    CSRF_FAILED,
    FORBIDDEN,
    SURFACE_FORBIDDEN,
    VALIDATION_FAILED,
    LAST_ADMIN
}
