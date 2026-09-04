package com.example.deck.config;

import com.example.deck.service.AbuseRateLimitService;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.web.AbuseRateLimitInterceptor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = "app.abuse.rate-limit.enabled", havingValue = "true", matchIfMissing = true)
public class AbuseRateLimitWebConfig implements WebMvcConfigurer {

    private final AbuseRateLimitService service;
    private final ClientSignalHasher hasher;

    public AbuseRateLimitWebConfig(AbuseRateLimitService service, ClientSignalHasher hasher) {
        this.service = service;
        this.hasher = hasher;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AbuseRateLimitInterceptor(service, hasher));
    }
}
