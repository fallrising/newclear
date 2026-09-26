package com.fallrising.cms;

import com.fallrising.cms.api.error.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class ApiExceptionHandlerTests {

    @Test
    @SuppressWarnings("unchecked")
    void B14_unexpectedExceptionIsInternalErrorWithoutDetails() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/v1/entries");
        request.setAttribute("requestId", "rid-500");
        ResponseEntity<Map<String, Object>> response =
                new ApiExceptionHandler().unexpected(new IllegalStateException("secret detail"), request);
        assertThat(response.getStatusCode().value()).isEqualTo(500);
        Map<String, Object> error = (Map<String, Object>) response.getBody().get("error");
        assertThat(error).containsEntry("code", "INTERNAL_ERROR").containsEntry("message", "Internal error");
        assertThat(response.getBody()).containsEntry("requestId", "rid-500");
        assertThat(response.getBody().toString()).doesNotContain("secret detail");
    }
}
