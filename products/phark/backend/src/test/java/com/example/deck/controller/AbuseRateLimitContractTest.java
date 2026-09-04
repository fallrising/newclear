package com.example.deck.controller;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.context.TestPropertySource;
import org.springframework.core.env.Environment;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "app.abuse.rate-limit.enabled=true")
class AbuseRateLimitContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private ClientSignalHasher hasher;

    @Autowired
    private Environment environment;

    @BeforeEach
    void cleanBuckets() {
        jdbc.sql("DELETE FROM abuse_rate_limit_buckets").update();
    }

    @Test
    void focusedContractExplicitlyEnablesRateLimiting() {
        org.assertj.core.api.Assertions.assertThat(
                environment.getProperty("app.abuse.rate-limit.enabled", Boolean.class)).isTrue();
    }

    @Test
    void registrationConsumesIpQuotaAndExposesHeadersAtBoundary() throws Exception {
        long accountsBefore = count("accounts");
        for (int attempt = 1; attempt <= 5; attempt++) {
            mockMvc.perform(post("/api/accounts")
                            .with(csrf())
                            .with(remote("198.51.100.10"))
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"handle\":\"limit" + UUID.randomUUID().toString().replace("-", "").substring(0, 8)
                                    + "\",\"displayName\":\"Test\",\"password\":\"password-123456\"}"))
                    .andExpect(status().isCreated())
                    .andExpect(header().string("RateLimit-Limit", "5"))
                    .andExpect(header().string("RateLimit-Remaining", Integer.toString(5 - attempt)))
                    .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(header().string("RateLimit-Reset", org.hamcrest.Matchers.matchesPattern("[1-9][0-9]*")));
        }
        long beforeBlocked = count("accounts");
        mockMvc.perform(post("/api/accounts")
                        .with(csrf())
                        .with(remote("198.51.100.10"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"handle\":\"blocked" + UUID.randomUUID().toString().replace("-", "").substring(0, 8)
                                + "\",\"displayName\":\"Test\",\"password\":\"password-123456\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("RateLimit-Limit", "5"))
                .andExpect(header().string("RateLimit-Remaining", "0"))
                .andExpect(header().exists("RateLimit-Reset"))
                .andExpect(header().exists("Retry-After"))
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(jsonPath("$.type").value("urn:phark:problem:rate-limited"))
                .andExpect(jsonPath("$.status").value(429))
                .andExpect(jsonPath("$.title").value("Rate limit exceeded"))
                .andExpect(jsonPath("$.code").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.detail").value("Too many requests. Please try again later."))
                .andExpect(jsonPath("$.instance").value("/api/accounts"))
                .andExpect(jsonPath("$.requestId").isString())
                .andDo(result -> org.assertj.core.api.Assertions.assertThat(
                                result.getResponse().getContentAsString())
                        .doesNotContain("198.51.100.10", hasher.hashIp("198.51.100.10"),
                                "REGISTER", "IP", "ACCOUNT"))
                .andDo(result -> org.assertj.core.api.Assertions.assertThat(
                                result.getResponse().getHeader("Retry-After"))
                        .isEqualTo(result.getResponse().getHeader("RateLimit-Reset")))
                .andDo(result -> org.assertj.core.api.Assertions.assertThat(count("accounts"))
                        .isEqualTo(beforeBlocked));
        org.assertj.core.api.Assertions.assertThat(count("accounts")).isEqualTo(beforeBlocked);
        org.assertj.core.api.Assertions.assertThat(count("accounts")).isGreaterThan(accountsBefore);
    }

    @Test
    void acceptedDomainErrorKeepsHeadersAndConsumesQuota() throws Exception {
        mockMvc.perform(post("/api/accounts").with(csrf()).with(remote("198.51.100.11"))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("RateLimit-Limit", "5"))
                .andExpect(header().string("RateLimit-Remaining", "4"));
        org.assertj.core.api.Assertions.assertThat(count("abuse_rate_limit_buckets")).isEqualTo(1);
    }

    @Test
    void forwardingHeadersAreIgnored() throws Exception {
        String remote = "198.51.100.12";
        mockMvc.perform(post("/api/accounts").with(csrf()).with(remote(remote))
                        .header("Forwarded", "for=203.0.113.99")
                        .header("X-Forwarded-For", "203.0.113.98")
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        String expected = hasher.hashIp(remote);
        org.assertj.core.api.Assertions.assertThat(jdbc.sql(
                        "SELECT subject_hmac FROM abuse_rate_limit_buckets WHERE scope = 'REGISTER'")
                .query(String.class).list()).containsExactly(expected);
    }

    @Test
    void securityRejectsReportsBeforeQuotaAndAuthenticatedPostAndReplyReportsReach404() throws Exception {
        mockMvc.perform(post("/api/posts/1/reports").with(csrf()).with(remote("198.51.100.13")))
                .andExpect(status().isUnauthorized()).andExpect(header().doesNotExist("RateLimit-Limit"));
        org.assertj.core.api.Assertions.assertThat(count("abuse_rate_limit_buckets")).isZero();

        mockMvc.perform(post("/api/posts/1/reports").with(user(new AccountPrincipal(9, "user", null)))
                        .with(remote("198.51.100.13")))
                .andExpect(status().isForbidden()).andExpect(header().doesNotExist("RateLimit-Limit"));
        org.assertj.core.api.Assertions.assertThat(count("abuse_rate_limit_buckets")).isZero();

        mockMvc.perform(post("/api/posts/999999999/reports").with(user(new AccountPrincipal(9, "user", null)))
                        .with(csrf()).with(remote("198.51.100.13"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound())
                .andExpect(header().string("RateLimit-Limit", "10"))
                .andExpect(header().string("RateLimit-Remaining", "9"));

        mockMvc.perform(post("/api/replies/999999999/reports").with(user(new AccountPrincipal(10, "reply-user", null)))
                        .with(csrf()).with(remote("198.51.100.14"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound())
                .andExpect(header().string("RateLimit-Limit", "10"))
                .andExpect(header().string("RateLimit-Remaining", "9"));
        org.assertj.core.api.Assertions.assertThat(countScope("REPORT_WRITE")).isEqualTo(4);
        org.assertj.core.api.Assertions.assertThat(countScope("CONTENT_WRITE")).isZero();
    }

    private long count(String table) {
        return jdbc.sql("SELECT COUNT(*) FROM " + table).query(Long.class).single();
    }

    private long countScope(String scope) {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_rate_limit_buckets WHERE scope = :scope")
                .param("scope", scope).query(Long.class).single();
    }

    private static RequestPostProcessor remote(String address) {
        return request -> { request.setRemoteAddr(address); return request; };
    }
}
