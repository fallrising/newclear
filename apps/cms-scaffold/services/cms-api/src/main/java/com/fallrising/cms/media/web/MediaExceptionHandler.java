package com.fallrising.cms.media.web;

import com.fallrising.cms.identity.web.IdentityErrorWriter;
import com.fallrising.cms.media.MediaException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.LinkedHashMap;
import java.util.Map;

@RestControllerAdvice
public class MediaExceptionHandler {

    @ExceptionHandler(MediaException.class)
    public ResponseEntity<Map<String, Object>> handle(MediaException ex, HttpServletRequest request) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("code", ex.code());
        error.put("message", ex.getMessage());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", error);
        body.put("requestId", IdentityErrorWriter.requestId(request));
        return ResponseEntity.status(ex.status()).body(body);
    }
}
