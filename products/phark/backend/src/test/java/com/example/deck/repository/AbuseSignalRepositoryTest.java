package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.Account;
import com.example.deck.model.AbuseSignalAction;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.service.ClientSignalHasher;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class AbuseSignalRepositoryTest {
    private static final long RETENTION_SECONDS = 30L * 24 * 60 * 60;
    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Autowired
    private AbuseSignalRepository signals;

    @Autowired
    private AccountRepository accounts;

    @Autowired
    private PostRepository posts;

    @Autowired
    private ReplyRepository replies;

    @Autowired
    private ClientSignalHasher hasher;

    @Autowired
    private JdbcClient jdbc;

    @Test
    void storesAllThreeExactMinimizedShapes() {
        Account actor = account("sigshape");
        Post post = posts.insertOwned(actor.id(), "known-content", "home");
        Reply reply = replies.insertOwned(post.id(), actor.id(), "known-reply");
        long reportId = insertReport(actor.id(), post.id());
        Instant createdAt = Instant.parse("2026-09-04T12:34:56Z");
        long expiresAt = createdAt.getEpochSecond() + RETENTION_SECONDS;
        String rawAddress = "198.51.100.71";
        String ipHmac = hasher.hashIp(rawAddress);

        signals.insertPostCreated(actor.id(), post.id(), ipHmac, createdAt, expiresAt);
        signals.insertReplyCreated(actor.id(), reply.id(), ipHmac, createdAt, expiresAt);
        signals.insertReportCreated(actor.id(), reportId, ipHmac, createdAt, expiresAt);

        List<SignalRow> rows = signalRows();
        assertThat(rows).containsExactly(
                new SignalRow("POST_CREATED", actor.id(), post.id(), null, null,
                        ipHmac, "2026-09-04 12:34:56", expiresAt),
                new SignalRow("REPLY_CREATED", actor.id(), null, reply.id(), null,
                        ipHmac, "2026-09-04 12:34:56", expiresAt),
                new SignalRow("REPORT_CREATED", actor.id(), null, null, reportId,
                        ipHmac, "2026-09-04 12:34:56", expiresAt));
        assertThat(rows.toString())
                .doesNotContain(rawAddress, "known-content", "known-reply");
        assertThat(AbuseSignalAction.values()).containsExactly(
                AbuseSignalAction.POST_CREATED,
                AbuseSignalAction.REPLY_CREATED,
                AbuseSignalAction.REPORT_CREATED);
    }

    @Test
    void rejectsInvalidIdentifiersHmacAndTimeBeforeSql() {
        Instant createdAt = Instant.ofEpochSecond(1_000);
        String validHmac = "a".repeat(64);

        assertThatThrownBy(() -> signals.insertPostCreated(
                0, 1, validHmac, createdAt, 2_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> signals.insertReplyCreated(
                1, -1, validHmac, createdAt, 2_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> signals.insertReportCreated(
                1, 1, "A".repeat(64), createdAt, 2_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> signals.insertPostCreated(
                1, 1, "a".repeat(63), createdAt, 2_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> signals.insertPostCreated(
                1, 1, validHmac, null, 2_000))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> signals.insertPostCreated(
                1, 1, validHmac, createdAt, createdAt.getEpochSecond()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(countSignals()).isZero();
    }

    @Test
    void databaseUniquenessAndForeignKeysRemainAuthoritative() {
        Account actor = account("sigcon");
        Post post = posts.insertOwned(actor.id(), "content", "home");
        Instant createdAt = Instant.ofEpochSecond(1_000);
        signals.insertPostCreated(actor.id(), post.id(), "a".repeat(64), createdAt,
                createdAt.getEpochSecond() + RETENTION_SECONDS);

        assertThatThrownBy(() -> signals.insertPostCreated(
                actor.id(), post.id(), "b".repeat(64), createdAt,
                createdAt.getEpochSecond() + RETENTION_SECONDS))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> signals.insertReplyCreated(
                actor.id(), Long.MAX_VALUE, "a".repeat(64), createdAt,
                createdAt.getEpochSecond() + RETENTION_SECONDS))
                .isInstanceOf(DataAccessException.class);
        assertThat(countSignals()).isEqualTo(1);
    }

    @Test
    void targetAndActorDeletesCascadeSignals() {
        Account actor = account("sigact");
        Account other = account("sigoth");
        Post actorPost = posts.insertOwned(actor.id(), "actor post", "home");
        Post otherPost = posts.insertOwned(other.id(), "other post", "home");
        Reply otherReply = replies.insertOwned(otherPost.id(), other.id(), "reply");
        long reportId = insertReport(other.id(), otherPost.id());
        Instant createdAt = Instant.ofEpochSecond(1_000);
        long expiresAt = createdAt.getEpochSecond() + RETENTION_SECONDS;

        signals.insertPostCreated(actor.id(), actorPost.id(), "a".repeat(64), createdAt, expiresAt);
        signals.insertReplyCreated(other.id(), otherReply.id(), "b".repeat(64), createdAt, expiresAt);
        signals.insertReportCreated(other.id(), reportId, "c".repeat(64), createdAt, expiresAt);
        assertThat(countSignals()).isEqualTo(3);

        jdbc.sql("DELETE FROM replies WHERE id = :id").param("id", otherReply.id()).update();
        jdbc.sql("DELETE FROM content_reports WHERE id = :id").param("id", reportId).update();
        assertThat(countSignals()).isEqualTo(1);
        jdbc.sql("DELETE FROM accounts WHERE id = :id").param("id", actor.id()).update();
        assertThat(countSignals()).isZero();
    }

    @Test
    void expiredCleanupUsesInclusiveBoundaryAndIsIdempotent() {
        Account actor = account("sigclean");
        Post expired = posts.insertOwned(actor.id(), "expired", "home");
        Post live = posts.insertOwned(actor.id(), "live", "home");
        signals.insertPostCreated(actor.id(), expired.id(), "a".repeat(64),
                Instant.ofEpochSecond(100 - RETENTION_SECONDS), 100);
        signals.insertPostCreated(actor.id(), live.id(), "b".repeat(64),
                Instant.ofEpochSecond(101 - RETENTION_SECONDS), 101);

        assertThat(signals.deleteExpired(100)).isEqualTo(1);
        assertThat(signals.deleteExpired(100)).isZero();
        assertThat(countSignals()).isEqualTo(1);
        assertThat(signals.deleteExpired(101)).isEqualTo(1);
        assertThat(countSignals()).isZero();
    }

    @Test
    void schemaDoesNotEnforceReportActorOwnership() {
        Account reporter = account("sigrep");
        Account differentActor = account("sigdiff");
        Post post = posts.insertOwned(reporter.id(), "reported", "home");
        long reportId = insertReport(reporter.id(), post.id());
        Instant createdAt = Instant.ofEpochSecond(1_000);

        signals.insertReportCreated(differentActor.id(), reportId, "a".repeat(64),
                createdAt, createdAt.getEpochSecond() + RETENTION_SECONDS);

        assertThat(jdbc.sql("SELECT actor_account_id FROM abuse_signals WHERE report_id = :id")
                .param("id", reportId).query(Long.class).single())
                .isEqualTo(differentActor.id());
    }

    private Account account(String handle) {
        return accounts.insert(handle, handle, "hash");
    }

    private long insertReport(long reporterId, long postId) {
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.sql("""
                INSERT INTO content_reports
                    (reporter_account_id, target_type, post_id, reason, status, expires_at_epoch)
                VALUES (:reporterId, 'POST', :postId, 'SPAM', 'RECEIVED', 2000000000)""")
                .param("reporterId", reporterId)
                .param("postId", postId)
                .update(keys);
        Number key = keys.getKey();
        if (key == null) {
            throw new IllegalStateException("Missing report id");
        }
        return key.longValue();
    }

    private long countSignals() {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_signals").query(Long.class).single();
    }

    private List<SignalRow> signalRows() {
        return jdbc.sql("""
                SELECT action_kind, actor_account_id, post_id, reply_id, report_id,
                       ip_hmac, created_at, expires_at_epoch
                FROM abuse_signals
                ORDER BY id""")
                .query((rs, row) -> new SignalRow(
                        rs.getString("action_kind"),
                        rs.getLong("actor_account_id"),
                        nullableLong(rs.getObject("post_id")),
                        nullableLong(rs.getObject("reply_id")),
                        nullableLong(rs.getObject("report_id")),
                        rs.getString("ip_hmac"),
                        rs.getString("created_at"),
                        rs.getLong("expires_at_epoch")))
                .list();
    }

    private Long nullableLong(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    private record SignalRow(
            String action,
            long actorId,
            Long postId,
            Long replyId,
            Long reportId,
            String ipHmac,
            String createdAt,
            long expiresAt) {}
}
