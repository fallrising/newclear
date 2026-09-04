package com.example.deck.error;

import com.example.deck.web.RequestIdFilter;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;

@Component
public class ApiProblemWriter {

    private final ObjectMapper objectMapper;

    public ApiProblemWriter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public ProblemDetail build(
            ApiErrorCode code,
            String path,
            String detail,
            String requestId) {
        ProblemDetail problem = ProblemDetail.forStatus(code.getHttpStatus());
        problem.setType(code.getType());
        problem.setTitle(code.getTitle());
        problem.setDetail(detail);
        problem.setInstance(URI.create(path));
        problem.setProperty("code", code.name());
        problem.setProperty("requestId", requestId);
        return problem;
    }

    public void write(
            HttpServletRequest request,
            HttpServletResponse response,
            ApiErrorCode code) throws IOException {
        if (response.isCommitted()) {
            return;
        }
        ProblemDetail problem = build(
                code,
                request.getRequestURI(),
                code.getDefaultDetail(),
                RequestIdFilter.resolveRequestId(request));
        response.setStatus(code.getHttpStatus().value());
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), problem);
    }
}
