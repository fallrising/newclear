package com.fallrising.cms.content;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class ContentException extends CmsApiException {

    public ContentException(ErrorCode code, String message) {
        super(code, message, null, null, null);
    }

    public static ContentException notFound() {
        return new ContentException(ErrorCode.ENTRY_NOT_FOUND, "Entry not found");
    }

    public static ContentException typeNotFound() {
        return new ContentException(ErrorCode.CONTENT_TYPE_NOT_FOUND, "Content type not found");
    }

    public static ContentException navNotFound() {
        return new ContentException(ErrorCode.NAVIGATION_NOT_FOUND, "Navigation not found");
    }

    public static ContentException audienceParam() {
        return new ContentException(
                ErrorCode.AUDIENCE_PARAM_REJECTED, "Public API does not accept state or draft parameters");
    }

    public static ContentException invalidTransition() {
        return new ContentException(ErrorCode.INVALID_STATE_TRANSITION, "Invalid publication state transition");
    }

    public static ContentException slugConflict() {
        return new ContentException(ErrorCode.SLUG_CONFLICT, "Slug already used in this type");
    }

    public static ContentException versionConflict() {
        return new ContentException(ErrorCode.VERSION_CONFLICT, "Entry version does not match");
    }

    public static ContentException validation(ErrorCode code, String message) {
        return new ContentException(code, message);
    }

    public static ContentException invalidParameter(String message) {
        return new ContentException(ErrorCode.VALIDATION_FAILED, message);
    }

    public static ContentException typeDisabled() {
        return new ContentException(ErrorCode.TYPE_DISABLED, "Content type is disabled");
    }

    public static ContentException typeInUse() {
        return new ContentException(ErrorCode.TYPE_IN_USE, "Content type still has entries");
    }

    public static ContentException refConstraint() {
        return new ContentException(ErrorCode.REF_CONSTRAINT, "Entry is still referenced");
    }

    public static ContentException singletonExists() {
        return new ContentException(ErrorCode.SINGLETON_EXISTS, "Singleton already exists");
    }
}
