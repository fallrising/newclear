package com.fallrising.cms.api.error;

import java.util.LinkedHashMap;
import java.util.Map;

/** Builds the ErrorEnvelope JSON body: { "error": { code, message, action?, contentType?, surface? }, "requestId" }. */
public final class ErrorBody {

    private ErrorBody() {}

    public static Map<String, Object> of(ErrorCode code, String message, String action, String contentType,
            String surface, String requestId) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", code.wire());
        error.put("message", message == null ? "" : message);
        if (action != null) {
            error.put("action", action);
        }
        if (contentType != null) {
            error.put("contentType", contentType);
        }
        if (surface != null) {
            error.put("surface", surface);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("requestId", requestId == null ? "" : requestId);
        return body;
    }

    public static Map<String, Object> of(CmsApiException ex, String requestId) {
        return of(ex.code(), ex.getMessage(), ex.action(), ex.contentType(), ex.surface(), requestId);
    }
}
