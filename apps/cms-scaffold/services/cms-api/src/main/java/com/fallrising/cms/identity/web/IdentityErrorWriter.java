package com.fallrising.cms.identity.web;

import com.fallrising.cms.api.error.ErrorBody;
import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.Map;

@Component
public class IdentityErrorWriter {

    public static final String ATTR = IdentityErrorWriter.class.getName() + ".request";

    private final ObjectMapper objectMapper;

    public IdentityErrorWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public Map<String, Object> body(IdentityException ex, String requestId) {
        return ErrorBody.of(ex, requestId);
    }

    public void write(HttpServletRequest request, HttpServletResponse response, IdentityException ex) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        String requestId = requestId(request);
        response.setStatus(ex.status().value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), body(ex, requestId));
    }

    public void write(HttpServletRequest request, HttpServletResponse response, ErrorCode code, String message)
            throws IOException {
        write(request, response, new IdentityException(code, message, null, null, null));
    }

    public static String requestId(HttpServletRequest request) {
        IdentityRequest identity = (IdentityRequest) request.getAttribute(ATTR);
        if (identity != null && identity.requestId() != null) {
            return identity.requestId();
        }
        Object raw = request.getAttribute("requestId");
        return raw == null ? "" : raw.toString();
    }
}
