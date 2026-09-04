package com.example.deck.error;

import com.example.deck.web.RequestIdFilter;
import com.example.deck.service.ImageTooLargeException;
import com.example.deck.service.InvalidImageException;
import com.example.deck.service.RateLimitExceededException;
import com.example.deck.web.RateLimitHeaders;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.TypeMismatchException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private final ApiProblemWriter problemWriter;

    public ApiExceptionHandler(ApiProblemWriter problemWriter) {
        this.problemWriter = problemWriter;
    }

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Object> handleApiException(ApiException ex, HttpServletRequest request) {
        ApiErrorCode code = ex.getCode();
        ProblemDetail problem = problemWriter.build(
                code,
                request.getRequestURI(),
                ex.getDetail(),
                RequestIdFilter.resolveRequestId(request));
        return new ResponseEntity<>(problem, code.getHttpStatus());
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<Object> handleRateLimitExceeded(
            RateLimitExceededException ex, HttpServletRequest request, HttpServletResponse response) {
        ApiErrorCode code = ApiErrorCode.RATE_LIMITED;
        ProblemDetail problem = problemWriter.build(
                code, request.getRequestURI(), code.getDefaultDetail(),
                RequestIdFilter.resolveRequestId(request));
        RateLimitHeaders.write(response, ex);
        return new ResponseEntity<>(problem, code.getHttpStatus());
    }

    @ExceptionHandler(InvalidImageException.class)
    public ResponseEntity<Object> handleInvalidImage(InvalidImageException ex, HttpServletRequest request) {
        return problem(ApiErrorCode.INVALID_IMAGE, request);
    }

    @ExceptionHandler(ImageTooLargeException.class)
    public ResponseEntity<Object> handleImageTooLarge(ImageTooLargeException ex, HttpServletRequest request) {
        return problem(ApiErrorCode.IMAGE_TOO_LARGE, request);
    }

    @Override
    protected ResponseEntity<Object> handleMaxUploadSizeExceededException(
            MaxUploadSizeExceededException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.IMAGE_TOO_LARGE;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.VALIDATION_FAILED;
        List<ApiViolation> violations = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> new ApiViolation(fe.getField(), fe.getDefaultMessage()))
                .sorted()
                .toList();
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        problem.setProperty("violations", violations);
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleTypeMismatch(
            TypeMismatchException ex, HttpHeaders headers, HttpStatusCode status, WebRequest request) {
        ApiErrorCode code = ApiErrorCode.MALFORMED_REQUEST;
        if (ex instanceof MethodArgumentTypeMismatchException mex) {
            code = switch (mex.getName()) {
                case "limit" -> ApiErrorCode.INVALID_LIMIT;
                case "postId" -> ApiErrorCode.INVALID_POST_ID;
                case "replyId" -> ApiErrorCode.INVALID_REPLY_ID;
                case "mediaId" -> ApiErrorCode.INVALID_MEDIA_ID;
                default -> ApiErrorCode.MALFORMED_REQUEST;
            };
        }
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.MALFORMED_REQUEST;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMediaTypeNotSupported(
            HttpMediaTypeNotSupportedException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.UNSUPPORTED_MEDIA_TYPE;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpRequestMethodNotSupported(
            HttpRequestMethodNotSupportedException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.METHOD_NOT_ALLOWED;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleMissingServletRequestPart(
            MissingServletRequestPartException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.MALFORMED_REQUEST;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @Override
    protected ResponseEntity<Object> handleNoResourceFoundException(
            NoResourceFoundException ex,
            HttpHeaders headers,
            HttpStatusCode status,
            WebRequest request) {
        ApiErrorCode code = ApiErrorCode.RESOURCE_NOT_FOUND;
        ProblemDetail problem = problemWriter.build(
                code,
                getRequestPath(request),
                code.getDefaultDetail(),
                resolveRequestId(request));
        return handleExceptionInternal(ex, problem, headers, code.getHttpStatus(), request);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleAllUnhandled(Exception ex, HttpServletRequest request) {
        String requestId = RequestIdFilter.resolveRequestId(request);
        log.error("Unhandled API exception [requestId={}]", requestId, ex);
        ApiErrorCode code = ApiErrorCode.INTERNAL_ERROR;
        ProblemDetail problem = problemWriter.build(
                code,
                request.getRequestURI(),
                code.getDefaultDetail(),
                requestId);
        return new ResponseEntity<>(problem, code.getHttpStatus());
    }

    private ResponseEntity<Object> problem(ApiErrorCode code, HttpServletRequest request) {
        ProblemDetail problem = problemWriter.build(
                code,
                request.getRequestURI(),
                code.getDefaultDetail(),
                RequestIdFilter.resolveRequestId(request));
        return new ResponseEntity<>(problem, code.getHttpStatus());
    }

    private static String getRequestPath(WebRequest request) {
        if (request instanceof ServletWebRequest swr) {
            return swr.getRequest().getRequestURI();
        }
        return request.getDescription(false).replace("uri=", "");
    }

    private static String resolveRequestId(WebRequest request) {
        if (request instanceof ServletWebRequest swr) {
            return RequestIdFilter.resolveRequestId(swr.getRequest());
        }
        return UUID.randomUUID().toString();
    }
}
