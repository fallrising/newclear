package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthService;
import com.fallrising.cms.identity.store.IdentityStore;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Component
public class IdentityRequestFilter extends OncePerRequestFilter {

    public static final String COOKIE_SESSION = "cms_session";
    public static final String COOKIE_CSRF = "cms_csrf";
    public static final String HEADER_CSRF = "X-CSRF-Token";
    public static final String HEADER_SURFACE = "X-CMS-Surface";

    private final IdentityStore store;
    private final IdentityProperties properties;
    private final AuthService authService;

    public IdentityRequestFilter(IdentityStore store, IdentityProperties properties, AuthService authService) {
        this.store = store;
        this.properties = properties;
        this.authService = authService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        IdentityRequest identity = new IdentityRequest();
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || requestId.isBlank()) requestId = UUID.randomUUID().toString();
        identity.setRequestId(requestId);
        identity.setOrigin(request.getHeader("Origin"));
        identity.setIp(request.getRemoteAddr());
        identity.setUserAgent(request.getHeader("User-Agent"));

        String cookieToken = cookie(request, COOKIE_SESSION);
        String bearer = bearer(request);
        identity.setCookieAuth(cookieToken != null);
        identity.setBearerAuth(cookieToken == null && bearer != null);
        identity.setSurface(resolveSurface(request, cookieToken != null, cookieToken == null && bearer != null));

        request.setAttribute(IdentityErrorWriter.ATTR, identity);
        request.setAttribute("requestId", requestId);
        response.setHeader("X-Request-Id", requestId);

        String token = cookieToken != null ? cookieToken : bearer;
        if (token != null) loadSession(identity, token);

        if (identity.principal() != null) {
            UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
                    identity.principal().username(), null, List.of(new SimpleGrantedAuthority("ROLE_USER")));
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }

        try {
            filterChain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }

    private void loadSession(IdentityRequest identity, String token) {
        Instant now = Instant.now();
        store.findSessionByTokenHash(SessionTokens.sha256(token)).ifPresentOrElse(session -> {
            if (session.revoked()) {
                identity.setTokenState(IdentityRequest.TokenState.REVOKED);
                return;
            }
            if (session.expired(now)) {
                identity.setTokenState(IdentityRequest.TokenState.EXPIRED);
                return;
            }
            Principal principal = store.findPrincipalById(session.principalId()).orElse(null);
            if (principal == null || principal.status() == PrincipalStatus.DISABLED) {
                identity.setTokenState(IdentityRequest.TokenState.REVOKED);
                return;
            }
            try {
                SessionRecord touched = authService.touch(session, now);
                identity.setSession(touched);
                identity.setPrincipal(principal);
                identity.setTokenState(IdentityRequest.TokenState.VALID);
            } catch (com.fallrising.cms.identity.IdentityException e) {
                identity.setTokenState(IdentityRequest.TokenState.REVOKED);
            }
        }, () -> identity.setTokenState(IdentityRequest.TokenState.EXPIRED));
    }

    private Surface resolveSurface(HttpServletRequest request, boolean cookieAuth, boolean bearerAuth) {
        String origin = request.getHeader("Origin");
        if (origin != null && !origin.isBlank()) return properties.surfaceForOrigin(origin);
        if (cookieAuth) return Surface.FRONT;
        if (bearerAuth) return Surface.fromWire(request.getHeader(HEADER_SURFACE));
        return Surface.fromWire(request.getHeader(HEADER_SURFACE));
    }

    static String cookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) return null;
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName()) && cookie.getValue() != null && !cookie.getValue().isBlank()) return cookie.getValue();
        }
        return null;
    }

    private static String bearer(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) return null;
        String token = header.substring(7).trim();
        return token.isEmpty() ? null : token;
    }
}
