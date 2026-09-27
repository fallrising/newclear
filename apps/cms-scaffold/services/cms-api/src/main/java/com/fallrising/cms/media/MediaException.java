package com.fallrising.cms.media;

import com.fallrising.cms.api.error.CmsApiException;
import com.fallrising.cms.api.error.ErrorCode;

public class MediaException extends CmsApiException {

    public MediaException(ErrorCode code, String message) {
        super(code, message, null, null, null);
    }

    public static MediaException notFound() {
        return new MediaException(ErrorCode.MEDIA_NOT_FOUND, "Media not found");
    }

    public static MediaException variantNotAvailable() {
        return new MediaException(ErrorCode.MEDIA_VARIANT_NOT_AVAILABLE, "Variant is not available");
    }

    public static MediaException unsupportedType() {
        return new MediaException(ErrorCode.MEDIA_UNSUPPORTED_TYPE, "File type is not allowed");
    }

    public static MediaException quota() {
        return new MediaException(ErrorCode.MEDIA_QUOTA_EXCEEDED, "Media library quota exceeded");
    }

    public static MediaException tooLarge() {
        return new MediaException(ErrorCode.MEDIA_FILE_TOO_LARGE, "File exceeds max size");
    }

    public static MediaException gone() {
        return new MediaException(ErrorCode.MEDIA_GONE, "Media has been deleted");
    }
}
