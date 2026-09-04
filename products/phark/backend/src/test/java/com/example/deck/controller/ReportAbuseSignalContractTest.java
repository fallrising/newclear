package com.example.deck.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.dto.CreateContentReportRequest;
import com.example.deck.model.Account;
import com.example.deck.model.ContentReportReason;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import com.example.deck.security.AccountPrincipal;
import com.example.deck.service.ClientSignalHasher;
import com.example.deck.service.ContentReportService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class ReportAbuseSignalContractTest {
    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired AccountRepository accounts;
    @Autowired PostRepository posts;
    @Autowired ReplyRepository replies;
    @Autowired ContentReportService reportService;
    @Autowired ClientSignalHasher hasher;
    @Autowired JdbcClient jdbc;

    private final List<Long> accountIds = new ArrayList<>();

    @AfterEach
    void cleanAccounts() {
        for (long accountId : accountIds) {
            jdbc.sql("DELETE FROM posts WHERE author_account_id = :id")
                    .param("id", accountId).update();
            jdbc.sql("DELETE FROM accounts WHERE id = :id").param("id", accountId).update();
        }
        accountIds.clear();
    }

    @Test
    void postAndReplyReportsRecordReporterOwnedResolvedRemoteSignals() throws Exception {
        Account author = account("rsg_author");
        Account reporter = account("rsg_actor");
        Post post = posts.insertOwned(author.id(), "post", "home");
        Reply reply = replies.insertOwned(post.id(), author.id(), "reply");
        AccountPrincipal principal = new AccountPrincipal(reporter.id(), reporter.handle(), null);

        long postReportId = report("/api/posts/" + post.id() + "/reports", principal,
                "198.51.100.90", "203.0.113.90", "SPAM");
        long replyReportId = report("/api/replies/" + reply.id() + "/reports", principal,
                "198.51.100.91", "203.0.113.91", "HARASSMENT");

        assertThat(signals(reporter.id())).containsExactly(
                new SignalRow("REPORT_CREATED", reporter.id(), postReportId, reporter.id(),
                        "POST", post.id(), null, hasher.hashIp("198.51.100.90")),
                new SignalRow("REPORT_CREATED", reporter.id(), replyReportId, reporter.id(),
                        "REPLY", null, reply.id(), hasher.hashIp("198.51.100.91")));
        assertThat(signals(reporter.id()).stream().map(SignalRow::ipHmac))
                .doesNotContain(hasher.hashIp("203.0.113.90"), hasher.hashIp("203.0.113.91"));
    }

    @Test
    void signalFailureRollsBackNewReport() {
        Account author = account("rsr_author");
        Account reporter = account("rsr_actor");
        Post post = posts.insertOwned(author.id(), "post", "home");

        assertThatThrownBy(() -> reportService.reportPost(post.id(), reporter.id(),
                new CreateContentReportRequest(ContentReportReason.SPAM), "invalid"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(reportCount()).isZero();
        assertThat(signalCount()).isZero();
    }

    @Test
    void duplicateLeavesOriginalReportAndSignalUnchanged() throws Exception {
        Account author = account("rsd_author");
        Account reporter = account("rsd_actor");
        Post post = posts.insertOwned(author.id(), "post", "home");
        AccountPrincipal principal = new AccountPrincipal(reporter.id(), reporter.handle(), null);
        report("/api/posts/" + post.id() + "/reports", principal,
                "198.51.100.92", "203.0.113.92", "SPAM");
        String before = joinedRows();

        mockMvc.perform(post("/api/posts/" + post.id() + "/reports")
                        .with(user(principal)).with(csrf()).with(remote("198.51.100.93"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"reason\":\"OTHER\"}"))
                .andExpect(status().isConflict());

        assertThat(reportCount()).isEqualTo(1);
        assertThat(signalCount()).isEqualTo(1);
        assertThat(joinedRows()).isEqualTo(before);
    }

    @Test
    void authenticationAndCsrfFailuresCreateNeitherReportNorSignal() throws Exception {
        Account author = account("rsa_author");
        Account reporter = account("rsa_actor");
        Post post = posts.insertOwned(author.id(), "post", "home");
        AccountPrincipal principal = new AccountPrincipal(reporter.id(), reporter.handle(), null);
        String body = "{\"reason\":\"SPAM\"}";

        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(csrf())
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post("/api/posts/" + post.id() + "/reports").with(user(principal))
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        assertThat(reportCount()).isZero();
        assertThat(signalCount()).isZero();
    }

    private long report(String path, AccountPrincipal principal, String remoteAddress,
                        String spoofedAddress, String reason) throws Exception {
        String response = mockMvc.perform(post(path).with(user(principal)).with(csrf())
                        .with(remote(remoteAddress)).header("X-Forwarded-For", spoofedAddress)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString();
        JsonNode body = objectMapper.readTree(response);
        assertThat(body.size()).isEqualTo(6);
        assertThat(response).doesNotContain(
                remoteAddress, spoofedAddress, hasher.hashIp(remoteAddress),
                "ipHmac", "reporterAccountId", "actorAccountId", "expiresAtEpoch");
        return body.path("id").longValue();
    }

    private org.springframework.test.web.servlet.request.RequestPostProcessor remote(String value) {
        return request -> {
            request.setRemoteAddr(value);
            return request;
        };
    }

    private List<SignalRow> signals(long actorId) {
        return jdbc.sql("""
                        SELECT s.action_kind, s.actor_account_id, s.report_id,
                               r.reporter_account_id, r.target_type, r.post_id,
                               r.reply_id, s.ip_hmac
                        FROM abuse_signals s
                        JOIN content_reports r ON r.id = s.report_id
                        WHERE s.actor_account_id = :actorId
                        ORDER BY s.id""")
                .param("actorId", actorId)
                .query((rs, row) -> new SignalRow(
                        rs.getString("action_kind"), rs.getLong("actor_account_id"),
                        rs.getLong("report_id"), rs.getLong("reporter_account_id"),
                        rs.getString("target_type"), nullableLong(rs, "post_id"),
                        nullableLong(rs, "reply_id"), rs.getString("ip_hmac")))
                .list();
    }

    private Long nullableLong(ResultSet resultSet, String column) throws SQLException {
        long value = resultSet.getLong(column);
        return resultSet.wasNull() ? null : value;
    }

    private String joinedRows() {
        return jdbc.sql("""
                        SELECT r.id || '|' || r.reporter_account_id || '|' || r.reason || '|'
                               || r.status || '|' || r.created_at || '|' || r.expires_at_epoch || '|'
                               || s.id || '|' || s.actor_account_id || '|' || s.ip_hmac || '|'
                               || s.created_at || '|' || s.expires_at_epoch
                        FROM content_reports r JOIN abuse_signals s ON s.report_id = r.id""")
                .query(String.class).single();
    }

    private long reportCount() {
        return jdbc.sql("SELECT COUNT(*) FROM content_reports").query(Long.class).single();
    }

    private long signalCount() {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_signals").query(Long.class).single();
    }

    private Account account(String handle) {
        Account account = accounts.insert(handle, handle, "hash");
        accountIds.add(account.id());
        return account;
    }

    private record SignalRow(
            String action,
            long actorId,
            long reportId,
            long reporterId,
            String targetType,
            Long postId,
            Long replyId,
            String ipHmac) {}
}
