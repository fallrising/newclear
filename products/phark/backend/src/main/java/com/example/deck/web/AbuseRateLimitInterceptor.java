package com.example.deck.web;

import com.example.deck.model.RateLimitResult;
import com.example.deck.model.RateLimitScope;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.AbuseRateLimitService;
import com.example.deck.service.ClientSignalHasher;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;

public final class AbuseRateLimitInterceptor implements HandlerInterceptor {

    private final AbuseRateLimitService service;
    private final ClientSignalHasher hasher;

    public AbuseRateLimitInterceptor(AbuseRateLimitService service, ClientSignalHasher hasher) {
        this.service = service;
        this.hasher = hasher;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request, HttpServletResponse response, Object handler) {
        RateLimitScope scope = scopeFor(request);
        if (scope == null) {
            return true;
        }

        Long accountId = null;
        if (scope.authenticated()) {
            Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
            if (authentication == null || !(authentication.getPrincipal() instanceof AccountPrincipal principal)) {
                throw new IllegalStateException("Authenticated rate-limit scope requires an account principal");
            }
            accountId = principal.getAccountId();
        }

        RateLimitResult result = service.reserve(scope, accountId, hasher.hashIp(request.getRemoteAddr()));
        RateLimitHeaders.write(response, result);
        return true;
    }

    static RateLimitScope scopeFor(HttpServletRequest request) {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        String method = request.getMethod();
        if ("POST".equals(method)) {
            if ("/api/accounts".equals(path)) return RateLimitScope.REGISTER;
            if ("/api/auth/login".equals(path)) return RateLimitScope.LOGIN;
            if ("/api/posts".equals(path)) return RateLimitScope.CONTENT_WRITE;
            if (oneSegment(path, "/api/posts/", "/replies")) return RateLimitScope.CONTENT_WRITE;
            if (oneSegment(path, "/api/posts/", "/reports")
                    || oneSegment(path, "/api/replies/", "/reports")) return RateLimitScope.REPORT_WRITE;
        }
        if (("PUT".equals(method) || "DELETE".equals(method))
                && (oneSegment(path, "/api/posts/", "/like")
                || oneSegment(path, "/api/posts/", "/repost"))) return RateLimitScope.SOCIAL_WRITE;
        return null;
    }

    private static boolean oneSegment(String path, String prefix, String suffix) {
        if (!path.startsWith(prefix) || !path.endsWith(suffix)) return false;
        String segment = path.substring(prefix.length(), path.length() - suffix.length());
        return !segment.isEmpty() && segment.indexOf('/') < 0;
    }
}
