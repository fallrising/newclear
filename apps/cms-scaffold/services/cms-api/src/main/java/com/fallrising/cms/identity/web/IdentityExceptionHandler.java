package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.IdentityException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.Map;

@RestControllerAdvice
public class IdentityExceptionHandler {

    private final IdentityErrorWriter errorWriter;

    public IdentityExceptionHandler(IdentityErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @ExceptionHandler(IdentityException.class)
    public ResponseEntity<Map<String, Object>> handle(IdentityException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.status()).body(errorWriter.body(ex, IdentityErrorWriter.requestId(request)));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> validation(MethodArgumentNotValidException ex, HttpServletRequest request) {
        IdentityException wrapped = IdentityException.validation("Invalid request");
        return ResponseEntity.status(wrapped.status())
                .body(errorWriter.body(wrapped, IdentityErrorWriter.requestId(request)));
    }
}
