package com.example.deck.repository;

import com.example.deck.model.AbuseSignalAction;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AbuseSignalRepository {
    private static final Pattern HMAC = Pattern.compile("[0-9a-f]{64}");
    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcClient jdbcClient;

    public AbuseSignalRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public void insertPostCreated(
            long actorAccountId,
            long postId,
            String ipHmac,
            Instant createdAt,
            long expiresAtEpoch) {
        validate(actorAccountId, postId, ipHmac, createdAt, expiresAtEpoch);
        int inserted = jdbcClient.sql("""
                INSERT INTO abuse_signals
                    (action_kind, actor_account_id, post_id, ip_hmac,
                     created_at, expires_at_epoch)
                VALUES (:action, :actorAccountId, :postId, :ipHmac,
                        :createdAt, :expiresAtEpoch)""")
                .param("action", AbuseSignalAction.POST_CREATED.name())
                .param("actorAccountId", actorAccountId)
                .param("postId", postId)
                .param("ipHmac", ipHmac)
                .param("createdAt", sqliteTimestamp(createdAt))
                .param("expiresAtEpoch", expiresAtEpoch)
                .update();
        requireInserted(inserted);
    }

    public void insertReplyCreated(
            long actorAccountId,
            long replyId,
            String ipHmac,
            Instant createdAt,
            long expiresAtEpoch) {
        validate(actorAccountId, replyId, ipHmac, createdAt, expiresAtEpoch);
        int inserted = jdbcClient.sql("""
                INSERT INTO abuse_signals
                    (action_kind, actor_account_id, reply_id, ip_hmac,
                     created_at, expires_at_epoch)
                VALUES (:action, :actorAccountId, :replyId, :ipHmac,
                        :createdAt, :expiresAtEpoch)""")
                .param("action", AbuseSignalAction.REPLY_CREATED.name())
                .param("actorAccountId", actorAccountId)
                .param("replyId", replyId)
                .param("ipHmac", ipHmac)
                .param("createdAt", sqliteTimestamp(createdAt))
                .param("expiresAtEpoch", expiresAtEpoch)
                .update();
        requireInserted(inserted);
    }

    public void insertReportCreated(
            long actorAccountId,
            long reportId,
            String ipHmac,
            Instant createdAt,
            long expiresAtEpoch) {
        validate(actorAccountId, reportId, ipHmac, createdAt, expiresAtEpoch);
        int inserted = jdbcClient.sql("""
                INSERT INTO abuse_signals
                    (action_kind, actor_account_id, report_id, ip_hmac,
                     created_at, expires_at_epoch)
                VALUES (:action, :actorAccountId, :reportId, :ipHmac,
                        :createdAt, :expiresAtEpoch)""")
                .param("action", AbuseSignalAction.REPORT_CREATED.name())
                .param("actorAccountId", actorAccountId)
                .param("reportId", reportId)
                .param("ipHmac", ipHmac)
                .param("createdAt", sqliteTimestamp(createdAt))
                .param("expiresAtEpoch", expiresAtEpoch)
                .update();
        requireInserted(inserted);
    }

    public int deleteExpired(long currentEpochSecond) {
        return jdbcClient.sql("DELETE FROM abuse_signals WHERE expires_at_epoch <= :now")
                .param("now", currentEpochSecond)
                .update();
    }

    private void validate(
            long actorAccountId,
            long targetId,
            String ipHmac,
            Instant createdAt,
            long expiresAtEpoch) {
        if (actorAccountId <= 0
                || targetId <= 0
                || ipHmac == null
                || !HMAC.matcher(ipHmac).matches()
                || createdAt == null
                || expiresAtEpoch <= createdAt.getEpochSecond()) {
            throw new IllegalArgumentException("Invalid abuse signal");
        }
    }

    private String sqliteTimestamp(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC).format(SQLITE_DATETIME);
    }

    private void requireInserted(int inserted) {
        if (inserted != 1) {
            throw new IllegalStateException("Failed to insert abuse signal");
        }
    }
}
