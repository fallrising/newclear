package com.fallrising.cms.api.error;

import com.fallrising.cms.identity.web.IdentityErrorWriter;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.NoHandlerFoundException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.util.Map;

/** The only @RestControllerAdvice. Every error leaving a controller becomes an ErrorEnvelope (B-14). */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(CmsApiException.class)
    public ResponseEntity<Map<String, Object>> cms(CmsApiException ex, HttpServletRequest request) {
        return ResponseEntity.status(ex.status()).body(ErrorBody.of(ex, IdentityErrorWriter.requestId(request)));
    }

    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        HttpMessageNotReadableException.class,
        MethodArgumentTypeMismatchException.class,
        MissingServletRequestParameterException.class,
        MissingServletRequestPartException.class
    })
    public ResponseEntity<Map<String, Object>> badRequest(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.VALIDATION_FAILED, "Invalid request", request);
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> tooLarge(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.MEDIA_FILE_TOO_LARGE, "File exceeds max size", request);
    }

    @ExceptionHandler({NoHandlerFoundException.class, NoResourceFoundException.class})
    public ResponseEntity<Map<String, Object>> noRoute(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.ROUTE_NOT_FOUND, "No such route", request);
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> methodNotAllowed(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed", request);
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, Object>> mediaType(Exception ex, HttpServletRequest request) {
        return respond(ErrorCode.MEDIA_TYPE_NOT_SUPPORTED, "Content-Type not supported", request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> unexpected(Exception ex, HttpServletRequest request) {
        log.error("Unhandled exception for {} {}", request.getMethod(), request.getRequestURI(), ex);
        return respond(ErrorCode.INTERNAL_ERROR, "Internal error", request);
    }

    private static ResponseEntity<Map<String, Object>> respond(ErrorCode code, String message, HttpServletRequest request) {
        return ResponseEntity.status(code.status())
                .body(ErrorBody.of(code, message, null, null, null, IdentityErrorWriter.requestId(request)));
    }
}
