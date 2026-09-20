package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.IdentityException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Set;

@Component
public class CookieCsrfFilter extends OncePerRequestFilter {

    private static final Set<String> SAFE = Set.of(
            HttpMethod.GET.name(), HttpMethod.HEAD.name(), HttpMethod.OPTIONS.name(), HttpMethod.TRACE.name());

    private final IdentityErrorWriter errorWriter;

    public CookieCsrfFilter(IdentityErrorWriter errorWriter) {
        this.errorWriter = errorWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        IdentityRequest identity = (IdentityRequest) request.getAttribute(IdentityErrorWriter.ATTR);
        boolean unsafe = !SAFE.contains(request.getMethod());
        if (unsafe && identity != null && identity.cookieAuth() && identity.principal() != null) {
            String header = request.getHeader(IdentityRequestFilter.HEADER_CSRF);
            String cookie = IdentityRequestFilter.cookie(request, IdentityRequestFilter.COOKIE_CSRF);
            if (header == null || cookie == null || !header.equals(cookie)) {
                errorWriter.write(request, response, IdentityException.csrfFailed());
                return;
            }
        }
        filterChain.doFilter(request, response);
    }
}
