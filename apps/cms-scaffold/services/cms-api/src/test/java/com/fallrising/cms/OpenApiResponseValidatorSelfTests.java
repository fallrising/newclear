package com.fallrising.cms;

import com.fallrising.cms.support.OpenApiResponseValidator;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class OpenApiResponseValidatorSelfTests {

    static final String ENTRY = """
            {"id":"6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11","contentType":"album","slug":"a","publicationState":"draft",
             "version":1,"title":"A","payload":{"title":"A"},"dirty":false,"publishedAt":null,
             "updatedAt":"2026-09-25T00:00:00Z"%s}
            """;

    @Test
    void BW0_validWorkEntryPasses() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 200, ENTRY.formatted("")).hasErrors()).isFalse();
    }

    @Test
    void BW0_undocumentedPropertyFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 200, ENTRY.formatted(",\"extra\":1")).hasErrors()).isTrue();
    }

    @Test
    void BW0_undocumentedStatusFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 418,
                "{\"error\":{\"code\":\"FORBIDDEN\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isTrue();
    }

    @Test
    void BW0_unknownErrorCodeFails() throws Exception {
        assertThat(report("GET", "/api/v1/entries/6f1c2f2e-3a52-4c55-9d0e-1f4f0a3b9c11", 404,
                "{\"error\":{\"code\":\"NOPE\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isTrue();
    }

    @Test
    void BW0_undocumentedPathIsSkipped() throws Exception {
        assertThat(report("GET", "/api/v1/no-such-route", 404,
                "{\"error\":{\"code\":\"ROUTE_NOT_FOUND\",\"message\":\"x\"},\"requestId\":\"r\"}").hasErrors()).isFalse();
    }

    private static com.atlassian.oai.validator.report.ValidationReport report(String method, String path, int status, String body)
            throws java.io.UnsupportedEncodingException {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        MockHttpServletResponse response = new MockHttpServletResponse();
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(body);
        return OpenApiResponseValidator.validate(request, response);
    }
}
