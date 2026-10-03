package com.fallrising.cms.api.error;

import org.springframework.http.HttpStatus;

/** Base class of every exception that is rendered as an ErrorEnvelope with a known ErrorCode. */
public abstract class CmsApiException extends RuntimeException {

    private final ErrorCode code;
    private final String action;
    private final String contentType;
    private final String surface;

    protected CmsApiException(ErrorCode code, String message, String action, String contentType, String surface) {
        super(message);
        this.code = code;
        this.action = action;
        this.contentType = contentType;
        this.surface = surface;
    }

    public ErrorCode code() {
        return code;
    }

    public HttpStatus status() {
        return code.status();
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
}
