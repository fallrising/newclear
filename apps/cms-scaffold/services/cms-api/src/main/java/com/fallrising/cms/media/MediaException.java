package com.fallrising.cms.media;

import org.springframework.http.HttpStatus;

public class MediaException extends RuntimeException {

    private final HttpStatus status;
    private final String code;

    public MediaException(HttpStatus status, String code, String message) {
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

    public static MediaException notFound() {
        return new MediaException(HttpStatus.NOT_FOUND, "not_found", "Media not found");
    }

    public static MediaException variantNotAvailable() {
        return new MediaException(HttpStatus.NOT_FOUND, "variant_not_available", "Variant is not available");
    }

    public static MediaException unsupportedType() {
        return new MediaException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_media_type", "File type is not allowed");
    }

    public static MediaException quota() {
        return new MediaException(HttpStatus.CONFLICT, "quota_exceeded", "Media library quota exceeded");
    }

    public static MediaException tooLarge() {
        return new MediaException(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large", "File exceeds max size");
    }

    public static MediaException gone() {
        return new MediaException(HttpStatus.GONE, "gone", "Media has been deleted");
    }
}
