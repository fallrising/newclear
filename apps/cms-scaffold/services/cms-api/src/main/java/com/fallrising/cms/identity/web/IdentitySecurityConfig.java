package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.api.error.ErrorCode;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@EnableConfigurationProperties(IdentityProperties.class)
public class IdentitySecurityConfig {

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            IdentityRequestFilter identityRequestFilter,
            CookieCsrfFilter cookieCsrfFilter,
            IdentityErrorWriter errorWriter)
            throws Exception {
        http.csrf(csrf -> csrf.disable())
                .cors(Customizer.withDefaults())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(ex -> ex.authenticationEntryPoint((request, response, authException) -> {
                            IdentityRequest identity = (IdentityRequest) request.getAttribute(IdentityErrorWriter.ATTR);
                            if (identity != null
                                    && (identity.tokenState() == IdentityRequest.TokenState.EXPIRED
                                            || identity.tokenState() == IdentityRequest.TokenState.REVOKED)) {
                                errorWriter.write(request, response, IdentityException.sessionExpired());
                            } else {
                                errorWriter.write(request, response, IdentityException.unauthenticated());
                            }
                        })
                        .accessDeniedHandler((request, response, accessDeniedException) ->
                                errorWriter.write(
                                        request,
                                        response,
                                        ErrorCode.FORBIDDEN,
                                        "Forbidden")))
                .authorizeHttpRequests(auth -> auth.requestMatchers("/actuator/health", "/openapi.yaml")
                        .permitAll()
                        .requestMatchers(HttpMethod.OPTIONS, "/**")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/auth/csrf")
                        .permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/v1/auth/login")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/api/v1/public/**")
                        .permitAll()
                        .requestMatchers("/api/v1/**")
                        .authenticated()
                        .anyRequest()
                        .permitAll())
                .addFilterBefore(identityRequestFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(cookieCsrfFilter, IdentityRequestFilter.class);
        return http.build();
    }

    @Bean
    FilterRegistrationBean<IdentityRequestFilter> identityRequestFilterRegistration(IdentityRequestFilter filter) {
        FilterRegistrationBean<IdentityRequestFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    FilterRegistrationBean<CookieCsrfFilter> cookieCsrfFilterRegistration(CookieCsrfFilter filter) {
        FilterRegistrationBean<CookieCsrfFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(IdentityProperties properties) {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(properties.corsOriginList());
        configuration.setAllowCredentials(true);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-CSRF-Token", "X-CMS-Surface", "X-Request-Id"));
        configuration.setExposedHeaders(List.of("X-Request-Id"));
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
