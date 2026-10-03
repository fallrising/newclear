package com.fallrising.cms.api.error;

import org.springframework.http.HttpStatus;

/**
 * Every error.code the API returns. The wire value is what clients see; it must match
 * components.schemas.ErrorCode in openapi.yaml (checked by ErrorCodeContractTests).
 */
public enum ErrorCode {
    UNAUTHENTICATED("UNAUTHENTICATED", HttpStatus.UNAUTHORIZED),
    INVALID_CREDENTIALS("INVALID_CREDENTIALS", HttpStatus.UNAUTHORIZED),
    SESSION_EXPIRED("SESSION_EXPIRED", HttpStatus.UNAUTHORIZED),
    ACCOUNT_DISABLED("ACCOUNT_DISABLED", HttpStatus.FORBIDDEN),
    ACCOUNT_LOCKED("ACCOUNT_LOCKED", HttpStatus.FORBIDDEN),
    CSRF_FAILED("CSRF_FAILED", HttpStatus.FORBIDDEN),
    FORBIDDEN("FORBIDDEN", HttpStatus.FORBIDDEN),
    SURFACE_FORBIDDEN("SURFACE_FORBIDDEN", HttpStatus.FORBIDDEN),
    VALIDATION_FAILED("VALIDATION_FAILED", HttpStatus.BAD_REQUEST),
    LAST_ADMIN("LAST_ADMIN", HttpStatus.FORBIDDEN),
    ENTRY_NOT_FOUND("ENTRY_NOT_FOUND", HttpStatus.NOT_FOUND),
    CONTENT_TYPE_NOT_FOUND("CONTENT_TYPE_NOT_FOUND", HttpStatus.NOT_FOUND),
    NAVIGATION_NOT_FOUND("NAVIGATION_NOT_FOUND", HttpStatus.NOT_FOUND),
    AUDIENCE_PARAM_REJECTED("AUDIENCE_PARAM_REJECTED", HttpStatus.BAD_REQUEST),
    INVALID_STATE_TRANSITION("INVALID_STATE_TRANSITION", HttpStatus.CONFLICT),
    SLUG_CONFLICT("SLUG_CONFLICT", HttpStatus.CONFLICT),
    VERSION_CONFLICT("VERSION_CONFLICT", HttpStatus.CONFLICT),
    TYPE_DISABLED("TYPE_DISABLED", HttpStatus.CONFLICT),
    TYPE_IN_USE("TYPE_IN_USE", HttpStatus.CONFLICT),
    REF_CONSTRAINT("REF_CONSTRAINT", HttpStatus.CONFLICT),
    SINGLETON_EXISTS("SINGLETON_EXISTS", HttpStatus.CONFLICT),
    SLUG_REQUIRED("SLUG_REQUIRED", HttpStatus.UNPROCESSABLE_ENTITY),
    FIELD_VALIDATION("FIELD_VALIDATION", HttpStatus.UNPROCESSABLE_ENTITY),
    REF_TARGET_NOT_FOUND("REF_TARGET_NOT_FOUND", HttpStatus.UNPROCESSABLE_ENTITY),
    REF_TARGET_WRONG_TYPE("REF_TARGET_WRONG_TYPE", HttpStatus.UNPROCESSABLE_ENTITY),
    PRINCIPAL_REF_UNRESOLVED("PRINCIPAL_REF_UNRESOLVED", HttpStatus.UNPROCESSABLE_ENTITY),
    MEDIA_NOT_FOUND("not_found", HttpStatus.NOT_FOUND),
    MEDIA_VARIANT_NOT_AVAILABLE("variant_not_available", HttpStatus.NOT_FOUND),
    MEDIA_UNSUPPORTED_TYPE("unsupported_media_type", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
    MEDIA_QUOTA_EXCEEDED("quota_exceeded", HttpStatus.CONFLICT),
    MEDIA_FILE_TOO_LARGE("file_too_large", HttpStatus.PAYLOAD_TOO_LARGE),
    MEDIA_GONE("gone", HttpStatus.GONE),
    ROUTE_NOT_FOUND("ROUTE_NOT_FOUND", HttpStatus.NOT_FOUND),
    METHOD_NOT_ALLOWED("METHOD_NOT_ALLOWED", HttpStatus.METHOD_NOT_ALLOWED),
    MEDIA_TYPE_NOT_SUPPORTED("MEDIA_TYPE_NOT_SUPPORTED", HttpStatus.UNSUPPORTED_MEDIA_TYPE),
    INTERNAL_ERROR("INTERNAL_ERROR", HttpStatus.INTERNAL_SERVER_ERROR);

    private final String wire;
    private final HttpStatus status;

    ErrorCode(String wire, HttpStatus status) {
        this.wire = wire;
        this.status = status;
    }

    public String wire() {
        return wire;
    }

    public HttpStatus status() {
        return status;
    }
}
