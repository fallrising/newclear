package com.fallrising.cms.content;

import org.springframework.http.HttpStatus;

public class ContentException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public ContentException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public static ContentException notFound() {
        return new ContentException(HttpStatus.NOT_FOUND, "ENTRY_NOT_FOUND", "Entry not found");
    }

    public static ContentException typeNotFound() {
        return new ContentException(HttpStatus.NOT_FOUND, "CONTENT_TYPE_NOT_FOUND", "Content type not found");
    }

    public static ContentException navNotFound() {
        return new ContentException(HttpStatus.NOT_FOUND, "NAVIGATION_NOT_FOUND", "Navigation not found");
    }

    public static ContentException audienceParam() {
        return new ContentException(
                HttpStatus.BAD_REQUEST, "AUDIENCE_PARAM_REJECTED", "Public API does not accept state or draft parameters");
    }

    public static ContentException invalidTransition() {
        return new ContentException(HttpStatus.CONFLICT, "INVALID_STATE_TRANSITION", "Invalid publication state transition");
    }

    public static ContentException slugConflict() {
        return new ContentException(HttpStatus.CONFLICT, "SLUG_CONFLICT", "Slug already used in this type");
    }

    public static ContentException versionConflict() {
        return new ContentException(HttpStatus.CONFLICT, "VERSION_CONFLICT", "Entry version does not match");
    }

    public static ContentException validation(String code, String message) {
        return new ContentException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
    }

    public static ContentException typeDisabled() {
        return new ContentException(HttpStatus.CONFLICT, "TYPE_DISABLED", "Content type is disabled");
    }

    public static ContentException typeInUse() {
        return new ContentException(HttpStatus.CONFLICT, "TYPE_IN_USE", "Content type still has entries");
    }

    public static ContentException refConstraint() {
        return new ContentException(HttpStatus.CONFLICT, "REF_CONSTRAINT", "Entry is still referenced");
    }
}
