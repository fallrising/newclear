package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.repository.AbuseRateLimitRepository;
import com.example.deck.repository.AbuseSignalRepository;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.ContentReportRepository;
import com.example.deck.repository.PostRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;

@SpringBootTest
class ModerationRetentionServiceTest {
    private static final Instant CUTOFF = Instant.ofEpochSecond(1_800_000_000L);

    @Autowired ModerationRetentionService retentionService;
    @Autowired AbuseSignalRepository signals;
    @Autowired ContentReportRepository reports;
    @Autowired AbuseRateLimitRepository buckets;
    @Autowired AccountRepository accounts;
    @Autowired PostRepository posts;
    @Autowired JdbcClient jdbc;

    private final List<Long> accountIds = new ArrayList<>();

    @BeforeEach
    void cleanModerationRows() {
        jdbc.sql("DELETE FROM abuse_signals").update();
        jdbc.sql("DELETE FROM content_reports").update();
        jdbc.sql("DELETE FROM abuse_rate_limit_buckets").update();
    }

    @AfterEach
    void cleanAccounts() {
        for (long accountId : accountIds) {
            jdbc.sql("DELETE FROM accounts WHERE id = :id").param("id", accountId).update();
        }
        accountIds.clear();
    }

    @Test
    void samplesOneClockInstantDeletesInDependencyOrderAndReturnsOnlyCounts() {
        AbuseSignalRepository signalRepository = mock(AbuseSignalRepository.class);
        ContentReportRepository reportRepository = mock(ContentReportRepository.class);
        AbuseRateLimitRepository bucketRepository = mock(AbuseRateLimitRepository.class);
        Clock clock = mock(Clock.class);
        when(clock.instant()).thenReturn(CUTOFF.plusNanos(999_999_999));
        when(signalRepository.deleteExpired(CUTOFF.getEpochSecond())).thenReturn(2);
        when(reportRepository.deleteExpired(CUTOFF.getEpochSecond())).thenReturn(3);
        when(bucketRepository.deleteExpired(CUTOFF.getEpochSecond())).thenReturn(4);
        ModerationRetentionService service = new ModerationRetentionService(
                signalRepository, reportRepository, bucketRepository, clock);

        ModerationRetentionService.CleanupResult result = service.cleanupExpired();

        assertThat(result).isEqualTo(new ModerationRetentionService.CleanupResult(2, 3, 4));
        assertThat(result.toString()).doesNotContain("hmac", "account", "target", "ip");
        verify(clock).instant();
        InOrder order = inOrder(signalRepository, reportRepository, bucketRepository);
        order.verify(signalRepository).deleteExpired(CUTOFF.getEpochSecond());
        order.verify(reportRepository).deleteExpired(CUTOFF.getEpochSecond());
        order.verify(bucketRepository).deleteExpired(CUTOFF.getEpochSecond());
    }

    @Test
    void exactBoundariesAndRepeatedCleanupAreDeterministic() {
        Account actor = account("ret_boundary");
        Post expiredPost = posts.insertOwned(actor.id(), "expired", "home");
        Post livePost = posts.insertOwned(actor.id(), "live", "home");
        long expiredReport = insertReport(actor.id(), expiredPost.id(), CUTOFF.getEpochSecond());
        long liveReport = insertReport(actor.id(), livePost.id(), CUTOFF.getEpochSecond() + 1);
        insertSignal(actor.id(), expiredReport, "a".repeat(64), CUTOFF.getEpochSecond());
        insertSignal(actor.id(), liveReport, "b".repeat(64), CUTOFF.getEpochSecond() + 1);
        insertBucket("c".repeat(64), CUTOFF.getEpochSecond());
        insertBucket("d".repeat(64), CUTOFF.getEpochSecond() + 1);
        ModerationRetentionService fixed = new ModerationRetentionService(
                signals, reports, buckets, Clock.fixed(CUTOFF.plusNanos(123), ZoneOffset.UTC));

        assertThat(fixed.cleanupExpired())
                .isEqualTo(new ModerationRetentionService.CleanupResult(1, 1, 1));
        assertThat(count("abuse_signals")).isEqualTo(1);
        assertThat(count("content_reports")).isEqualTo(1);
        assertThat(count("abuse_rate_limit_buckets")).isEqualTo(1);
        assertThat(count("accounts")).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM posts WHERE id IN (:expiredId, :liveId)")
                .param("expiredId", expiredPost.id()).param("liveId", livePost.id())
                .query(Long.class).single()).isEqualTo(2);
        assertThat(fixed.cleanupExpired())
                .isEqualTo(new ModerationRetentionService.CleanupResult(0, 0, 0));
    }

    @Test
    void middleFailureRollsBackEarlierDeleteAndSkipsLaterDelete() {
        Account actor = account("ret_rollback");
        Post post = posts.insertOwned(actor.id(), "post", "home");
        long expired = Instant.now().minusSeconds(10).getEpochSecond();
        long reportId = insertReport(actor.id(), post.id(), expired);
        insertSignal(actor.id(), reportId, "e".repeat(64), expired);
        insertBucket("f".repeat(64), expired);
        jdbc.sql("""
                CREATE TRIGGER abort_report_retention BEFORE DELETE ON content_reports
                BEGIN
                    SELECT RAISE(ABORT, 'report retention blocked');
                END""").update();

        try {
            assertThatThrownBy(retentionService::cleanupExpired)
                    .isInstanceOf(DataAccessException.class);
            assertThat(count("abuse_signals")).isEqualTo(1);
            assertThat(count("content_reports")).isEqualTo(1);
            assertThat(count("abuse_rate_limit_buckets")).isEqualTo(1);
        } finally {
            jdbc.sql("DROP TRIGGER IF EXISTS abort_report_retention").update();
        }
    }

    private Account account(String handle) {
        Account account = accounts.insert(handle, handle, "hash");
        accountIds.add(account.id());
        return account;
    }

    private long insertReport(long reporterId, long postId, long expiresAt) {
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.sql("""
                        INSERT INTO content_reports
                            (reporter_account_id, target_type, post_id, reason, status, expires_at_epoch)
                        VALUES (:reporterId, 'POST', :postId, 'SPAM', 'RECEIVED', :expiresAt)""")
                .param("reporterId", reporterId).param("postId", postId)
                .param("expiresAt", expiresAt).update(keys);
        return keys.getKey().longValue();
    }

    private void insertSignal(long actorId, long reportId, String ipHmac, long expiresAt) {
        jdbc.sql("""
                        INSERT INTO abuse_signals
                            (action_kind, actor_account_id, report_id, ip_hmac, expires_at_epoch)
                        VALUES ('REPORT_CREATED', :actorId, :reportId, :ipHmac, :expiresAt)""")
                .param("actorId", actorId).param("reportId", reportId)
                .param("ipHmac", ipHmac).param("expiresAt", expiresAt).update();
    }

    private void insertBucket(String subjectHmac, long expiresAt) {
        long windowEnd = expiresAt - 86_400;
        jdbc.sql("""
                        INSERT INTO abuse_rate_limit_buckets
                            (scope, subject_kind, subject_hmac, window_start_epoch,
                             window_end_epoch, expires_at_epoch, request_count)
                        VALUES ('REGISTER', 'IP', :subjectHmac, :windowStart,
                                :windowEnd, :expiresAt, 1)""")
                .param("subjectHmac", subjectHmac).param("windowStart", windowEnd - 60)
                .param("windowEnd", windowEnd).param("expiresAt", expiresAt).update();
    }

    private long count(String table) {
        return jdbc.sql("SELECT COUNT(*) FROM " + table).query(Long.class).single();
    }
}
