package com.example.deck.controller;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ContentReportControllerTest {
    @Autowired MockMvc mockMvc;
    @Autowired AccountRepository accounts;
    @Autowired PostRepository posts;
    @Autowired ReplyRepository replies;
    @Autowired JdbcClient jdbc;
    private AccountPrincipal principal;

    @BeforeEach
    void setUp() {
        Account account = accounts.insert("reportctl", "Reporter", "hash");
        principal = new AccountPrincipal(account.id(), account.handle(), null);
    }

    @Test
    void reportsPostWithExactRedactedResponseAndDuplicateIsStable() throws Exception {
        Post post = posts.insert("Author", "Body", "home");
        String body = "{\"reason\":\"SPAM\",\"targetId\":999,\"body\":\"secret\"}";

        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().string("Content-Type", org.hamcrest.Matchers.startsWith("application/json")))
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.targetType").value("POST"))
                .andExpect(jsonPath("$.targetId").value(post.id()))
                .andExpect(jsonPath("$.reason").value("SPAM"))
                .andExpect(jsonPath("$.status").value("RECEIVED"))
                .andExpect(jsonPath("$.reporterAccountId").doesNotExist())
                .andExpect(jsonPath("$.expiresAtEpoch").doesNotExist())
                .andExpect(jsonPath("$.body").doesNotExist());

        StoredReport original = storedReport();
        long createdAtEpoch = LocalDateTime.parse(original.createdAt(),
                        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"))
                .toEpochSecond(ZoneOffset.UTC);
        org.assertj.core.api.Assertions.assertThat(original.reporterId()).isEqualTo(principal.getAccountId());
        org.assertj.core.api.Assertions.assertThat(original.postId()).isEqualTo(post.id());
        org.assertj.core.api.Assertions.assertThat(original.replyId()).isNull();
        org.assertj.core.api.Assertions.assertThat(original.expiresAtEpoch())
                .isEqualTo(createdAtEpoch + 180L * 24 * 60 * 60);

        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"OTHER\"}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("DUPLICATE_REPORT"));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports")
                .query(Long.class).single()).isEqualTo(1);
        org.assertj.core.api.Assertions.assertThat(storedReport()).isEqualTo(original);
    }

    @Test
    void authenticationAndCsrfAreRequired() throws Exception {
        Post post = posts.insert("Author", "Body", "home");
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(csrf()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isForbidden());
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports")
                .query(Long.class).single()).isZero();
    }

    @Test
    void reportsReplyAndKeepsPostAndReplyIdentitiesSeparate() throws Exception {
        Post post = posts.insert("Author", "Body", "home");
        Reply reply = replies.insert(post.id(), "Author", "Reply");
        mockMvc.perform(post("/api/replies/" + reply.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"HARASSMENT\"}"))
                .andExpect(status().isCreated())
                .andExpect(header().string("Cache-Control", "private, no-store"))
                .andExpect(header().doesNotExist("Location"))
                .andExpect(header().string("Content-Type", org.hamcrest.Matchers.startsWith("application/json")))
                .andExpect(jsonPath("$.length()").value(6))
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.targetType").value("REPLY"))
                .andExpect(jsonPath("$.targetId").value(reply.id()))
                .andExpect(jsonPath("$.reason").value("HARASSMENT"))
                .andExpect(jsonPath("$.status").value("RECEIVED"))
                .andExpect(jsonPath("$.createdAt").exists());
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT post_id, reply_id FROM content_reports")
                .query((rs, row) -> rs.getObject("post_id") + ":" + rs.getLong("reply_id")).single())
                .isEqualTo("null:" + reply.id());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"SPAM", "HARASSMENT", "HATE_OR_VIOLENCE", "SEXUAL_CONTENT", "OTHER"})
    void acceptsEverySupportedReason(String reason) throws Exception {
        Post post = posts.insert("Author", "Body", "home");
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.reason").value(reason));
    }

    @Test
    void malformedAndUnsupportedReasonsAreProblemDetailsWithoutWrites() throws Exception {
        Post post = posts.insert("Author", "Body", "home");
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
        for (String body : new String[] {"{}", "{\"reason\":null}", "{\"reason\":\"spam\"}", "{\"reason\":\"UNKNOWN\"}"}) {
            mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.type").value("urn:phark:problem:validation-failed"))
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{bad"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
        org.assertj.core.api.Assertions.assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports")
                .query(Long.class).single()).isZero();
    }

    @Test
    void noPublicReportReadUpdateOrDeleteEndpointExists() throws Exception {
        for (String path : new String[] {"/api/posts/1/reports", "/api/replies/1/reports"}) {
            mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(path))
                    .andExpect(status().isMethodNotAllowed());
            mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete(path).with(csrf()))
                    .andExpect(status().isMethodNotAllowed());
            mockMvc.perform(put(path).with(csrf())).andExpect(status().isMethodNotAllowed());
            mockMvc.perform(patch(path).with(csrf())).andExpect(status().isMethodNotAllowed());
        }
    }

    @Test
    void idsUseStableErrorsAndNormalErrorsDoNotRevealReportFields() throws Exception {
        for (String path : new String[] {"/api/posts/0/reports", "/api/posts/-1/reports", "/api/posts/nope/reports"}) {
            mockMvc.perform(post(path).with(user(principal)).with(csrf()).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"reason\":\"SPAM\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-post-id"))
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.code").value("INVALID_POST_ID"))
                    .andExpect(jsonPath("$.reporterAccountId").doesNotExist());
        }
        mockMvc.perform(post("/api/posts/99999999/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        for (String path : new String[] {"/api/replies/0/reports", "/api/replies/-1/reports",
                "/api/replies/nope/reports"}) {
            mockMvc.perform(post(path).with(user(principal)).with(csrf())
                            .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.type").value("urn:phark:problem:invalid-reply-id"))
                    .andExpect(jsonPath("$.status").value(400))
                    .andExpect(jsonPath("$.code").value("INVALID_REPLY_ID"));
        }
        mockMvc.perform(post("/api/replies/99999999/reports").with(user(principal)).with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"SPAM\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("REPLY_NOT_FOUND"));
    }

    private StoredReport storedReport() {
        return jdbc.sql("""
                        SELECT reporter_account_id, post_id, reply_id, reason,
                               status, created_at, expires_at_epoch
                        FROM content_reports""")
                .query((rs, row) -> new StoredReport(
                        rs.getLong("reporter_account_id"),
                        rs.getLong("post_id"),
                        (Long) rs.getObject("reply_id"),
                        rs.getString("reason"),
                        rs.getString("status"),
                        rs.getString("created_at"),
                        rs.getLong("expires_at_epoch")))
                .single();
    }

    private record StoredReport(
            long reporterId,
            long postId,
            Long replyId,
            String reason,
            String status,
            String createdAt,
            long expiresAtEpoch) {}
}
