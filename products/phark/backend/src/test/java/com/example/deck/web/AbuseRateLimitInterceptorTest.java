package com.example.deck.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.deck.model.RateLimitResult;
import com.example.deck.model.RateLimitScope;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.AbuseRateLimitService;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.RateLimitExceededException;
import java.nio.charset.StandardCharsets;
import java.util.Properties;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.core.io.ClassPathResource;

class AbuseRateLimitInterceptorTest {

    private final AbuseRateLimitService service = Mockito.mock(AbuseRateLimitService.class);
    private final ClientSignalHasher hasher = new ClientSignalHasher(new byte[32]);
    private final AbuseRateLimitInterceptor interceptor =
            new AbuseRateLimitInterceptor(service, hasher);

    @AfterEach
    void clearSecurity() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void ordinaryTestConfigurationResolvesRateLimitingDisabled() throws Exception {
        Properties properties = new Properties();
        try (var input = new ClassPathResource("application.properties").getInputStream()) {
            properties.load(new java.io.InputStreamReader(input, StandardCharsets.UTF_8));
        }

        assertThat(properties.getProperty("app.abuse.rate-limit.enabled")).isEqualTo("false");
    }

    @Test
    void mapsOnlyTheDocumentedExactShapes() {
        assertThat(scope("POST", "/api/accounts")).isEqualTo(RateLimitScope.REGISTER);
        assertThat(scope("POST", "/api/auth/login")).isEqualTo(RateLimitScope.LOGIN);
        assertThat(scope("POST", "/api/posts")).isEqualTo(RateLimitScope.CONTENT_WRITE);
        assertThat(scope("POST", "/api/posts/abc/replies")).isEqualTo(RateLimitScope.CONTENT_WRITE);
        assertThat(scope("PUT", "/api/posts/abc/like")).isEqualTo(RateLimitScope.SOCIAL_WRITE);
        assertThat(scope("PUT", "/api/posts/abc/repost")).isEqualTo(RateLimitScope.SOCIAL_WRITE);
        assertThat(scope("DELETE", "/api/posts/abc/like")).isEqualTo(RateLimitScope.SOCIAL_WRITE);
        assertThat(scope("DELETE", "/api/posts/abc/repost")).isEqualTo(RateLimitScope.SOCIAL_WRITE);
        assertThat(scope("POST", "/api/posts/abc/reports")).isEqualTo(RateLimitScope.REPORT_WRITE);
        assertThat(scope("POST", "/api/replies/abc/reports")).isEqualTo(RateLimitScope.REPORT_WRITE);

        assertThat(scope("GET", "/api/posts")).isNull();
        assertThat(scope("POST", "/api/posts/abc/replies/nested")).isNull();
        assertThat(scope("POST", "/api/posts/abc/reports/nested")).isNull();
        assertThat(scope("POST", "/api/posts/abc/like")).isNull();
        assertThat(scope("POST", "/api/posts/abc/replies")).isEqualTo(RateLimitScope.CONTENT_WRITE);
        assertThat(scope("POST", "/api/posts//replies")).isNull();
        assertThat(scope("POST", "/api/posts/abc/replies/")).isNull();
        assertThat(scope("POST", "/api/posts/abc/reports/")).isNull();
        assertThat(scope("PUT", "/api/posts/abc/like/extra")).isNull();
        assertThat(scope("PUT", "/api/posts/abc/like/nested/x")).isNull();
        assertThat(scope("PATCH", "/api/posts/abc/like")).isNull();
        assertThat(scope("GET", "/api/posts/abc/reports")).isNull();
        assertThat(scope("POST", "/api/auth/logout")).isNull();
        assertThat(scope("PATCH", "/api/profiles/me")).isNull();
        assertThat(scope("PUT", "/api/notifications/read")).isNull();
        MockHttpServletRequest contextRequest = request("POST", "/app/api/posts");
        contextRequest.setContextPath("/app");
        assertThat(AbuseRateLimitInterceptor.scopeFor(contextRequest)).isEqualTo(RateLimitScope.CONTENT_WRITE);
    }

    @Test
    void reservesBeforeReturningAndWritesClientHeaders() throws Exception {
        AccountPrincipal principal = new AccountPrincipal(7, "alice", null);
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken(principal, null));
        MockHttpServletRequest request = request("POST", "/api/posts");
        MockHttpServletResponse response = new MockHttpServletResponse();
        String ipHmac = hasher.hashIp("198.51.100.4");
        when(service.reserve(RateLimitScope.CONTENT_WRITE, 7L, ipHmac))
                .thenReturn(new RateLimitResult(20, 19, 42));

        assertThat(interceptor.preHandle(request, response, new Object())).isTrue();
        verify(service).reserve(RateLimitScope.CONTENT_WRITE, 7L, ipHmac);
        assertThat(response.getHeader("RateLimit-Limit")).isEqualTo("20");
        assertThat(response.getHeader("RateLimit-Remaining")).isEqualTo("19");
        assertThat(response.getHeader("RateLimit-Reset")).isEqualTo("42");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
    }

    @Test
    void deniedReservationWritesOnlyPublic429HeadersAndNoDownstreamCall() {
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken(new AccountPrincipal(7, "alice", null), null));
        when(service.reserve(Mockito.eq(RateLimitScope.CONTENT_WRITE), Mockito.eq(7L), Mockito.anyString()))
                .thenThrow(new RateLimitExceededException(20, 9));
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertThatThrownBy(() -> interceptor.preHandle(request("POST", "/api/posts"), response, new Object()))
                .isInstanceOf(RateLimitExceededException.class);
        assertThat(response.getHeader("RateLimit-Remaining")).isNull();
        // The exception handler owns the final 429 headers; preHandle never invokes a controller.
        assertThat(response.isCommitted()).isFalse();
    }

    private static RateLimitScope scope(String method, String path) {
        return AbuseRateLimitInterceptor.scopeFor(request(method, path));
    }

    private static MockHttpServletRequest request(String method, String path) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setRemoteAddr("198.51.100.4");
        return request;
    }
}
