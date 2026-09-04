package com.example.deck.repository;

import com.example.deck.model.ContentReport;
import com.example.deck.model.ContentReportReason;
import com.example.deck.model.ContentReportStatus;
import com.example.deck.model.ContentReportTargetType;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ContentReportRepository {
    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private final JdbcClient jdbcClient;

    public ContentReportRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public int deleteExpiredPostReport(long reporterId, long postId, long nowEpoch) {
        return jdbcClient.sql("DELETE FROM content_reports WHERE reporter_account_id = :reporterId "
                        + "AND post_id = :postId AND expires_at_epoch <= :nowEpoch")
                .param("reporterId", reporterId).param("postId", postId).param("nowEpoch", nowEpoch).update();
    }

    public int deleteExpiredReplyReport(long reporterId, long replyId, long nowEpoch) {
        return jdbcClient.sql("DELETE FROM content_reports WHERE reporter_account_id = :reporterId "
                        + "AND reply_id = :replyId AND expires_at_epoch <= :nowEpoch")
                .param("reporterId", reporterId).param("replyId", replyId).param("nowEpoch", nowEpoch).update();
    }

    public int deleteExpired(long currentEpochSecond) {
        return jdbcClient.sql("DELETE FROM content_reports WHERE expires_at_epoch <= :now")
                .param("now", currentEpochSecond).update();
    }

    public boolean hasLivePostReport(long reporterId, long postId, long nowEpoch) {
        return count("post_id", reporterId, postId, nowEpoch) > 0;
    }

    public boolean hasLiveReplyReport(long reporterId, long replyId, long nowEpoch) {
        return count("reply_id", reporterId, replyId, nowEpoch) > 0;
    }

    private long count(String targetColumn, long reporterId, long targetId, long nowEpoch) {
        return jdbcClient.sql("SELECT COUNT(*) FROM content_reports WHERE reporter_account_id = :reporterId "
                        + "AND " + targetColumn + " = :targetId AND expires_at_epoch > :nowEpoch")
                .param("reporterId", reporterId).param("targetId", targetId).param("nowEpoch", nowEpoch)
                .query(Long.class).single();
    }

    public ContentReport insert(long reporterId, ContentReportTargetType targetType, long targetId,
                                ContentReportReason reason, Instant createdAt, long expiresAtEpoch) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        String targetColumn = targetType == ContentReportTargetType.POST ? "post_id" : "reply_id";
        jdbcClient.sql("INSERT INTO content_reports (reporter_account_id, target_type, " + targetColumn
                            + ", reason, status, created_at, expires_at_epoch) VALUES (:reporterId, :targetType, "
                            + ":targetId, :reason, 'RECEIVED', :createdAt, :expiresAtEpoch)")
                    .param("reporterId", reporterId).param("targetType", targetType.name())
                    .param("targetId", targetId).param("reason", reason.name())
                    .param("createdAt", SQLITE_DATETIME.format(createdAt.atOffset(ZoneOffset.UTC)))
                    .param("expiresAtEpoch", expiresAtEpoch).update(keyHolder);
        Number key = keyHolder.getKey();
        if (key == null) throw new IllegalStateException("Failed to retrieve generated report id");
        return findById(key.longValue()).orElseThrow();
    }

    public Optional<ContentReport> findById(long id) {
        return jdbcClient.sql("SELECT id, target_type, post_id, reply_id, reason, status, created_at "
                        + "FROM content_reports WHERE id = :id").param("id", id)
                .query(this::map).optional();
    }

    private ContentReport map(ResultSet rs, int rowNum) throws SQLException {
        ContentReportTargetType type = ContentReportTargetType.valueOf(rs.getString("target_type"));
        long targetId = type == ContentReportTargetType.POST ? rs.getLong("post_id") : rs.getLong("reply_id");
        Instant createdAt = LocalDateTime.parse(rs.getString("created_at"), SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC);
        return new ContentReport(rs.getLong("id"), type, targetId,
                ContentReportReason.valueOf(rs.getString("reason")),
                ContentReportStatus.valueOf(rs.getString("status")), createdAt);
    }
}
