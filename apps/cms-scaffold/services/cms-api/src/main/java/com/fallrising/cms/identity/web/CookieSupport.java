package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.IdentityProperties;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import java.time.Duration;

@Component
public class CookieSupport {

    private final IdentityProperties properties;

    public CookieSupport(IdentityProperties properties) {
        this.properties = properties;
    }

    public void setSession(HttpServletResponse response, String token) {
        add(response, sessionCookie(token, properties.getSessionMax()));
    }

    public void clearSession(HttpServletResponse response) {
        add(response, sessionCookie("", Duration.ZERO));
    }

    public void setCsrf(HttpServletResponse response, String token) {
        add(response, csrfCookie(token, properties.getSessionMax()));
    }

    public void clearCsrf(HttpServletResponse response) {
        add(response, csrfCookie("", Duration.ZERO));
    }

    private ResponseCookie sessionCookie(String token, Duration maxAge) {
        return ResponseCookie.from(IdentityRequestFilter.COOKIE_SESSION, token)
                .httpOnly(true)
                .path("/")
                .sameSite("Lax")
                .secure(properties.isCookieSecure())
                .maxAge(maxAge)
                .build();
    }

    private ResponseCookie csrfCookie(String token, Duration maxAge) {
        return ResponseCookie.from(IdentityRequestFilter.COOKIE_CSRF, token)
                .httpOnly(false)
                .path("/")
                .sameSite("Lax")
                .secure(properties.isCookieSecure())
                .maxAge(maxAge)
                .build();
    }

    private static void add(HttpServletResponse response, ResponseCookie cookie) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
