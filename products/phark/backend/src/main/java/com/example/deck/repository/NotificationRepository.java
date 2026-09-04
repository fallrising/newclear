package com.example.deck.repository;

import com.example.deck.model.NotificationItem;
import com.example.deck.model.NotificationSummary;
import com.example.deck.model.NotificationType;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class NotificationRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcClient jdbcClient;

    public NotificationRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public long insertAndPrune(
            long recipientAccountId,
            long actorAccountId,
            long postId,
            Long replyId,
            NotificationType type) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcClient
                .sql("""
                        INSERT INTO notifications
                            (recipient_account_id, actor_account_id, post_id, reply_id, type)
                        VALUES (:recipientAccountId, :actorAccountId, :postId, :replyId, :type)""")
                .param("recipientAccountId", recipientAccountId)
                .param("actorAccountId", actorAccountId)
                .param("postId", postId)
                .param("replyId", replyId)
                .param("type", type.name())
                .update(keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated notification id");
        }

        pruneToLatest(recipientAccountId);
        return key.longValue();
    }

    private void pruneToLatest(long recipientAccountId) {
        jdbcClient
                .sql("""
                        DELETE FROM notifications
                        WHERE recipient_account_id = :recipientAccountId
                          AND id NOT IN (
                              SELECT id FROM notifications
                              WHERE recipient_account_id = :recipientAccountId
                              ORDER BY id DESC
                              LIMIT 500
                          )""")
                .param("recipientAccountId", recipientAccountId)
                .update();
    }

    public NotificationSummary findSummary(long recipientId) {
        return jdbcClient
                .sql("""
                        WITH state AS (
                            SELECT :recipientId AS recipient_account_id,
                                   r.read_through_id
                            FROM notification_read_state r
                            WHERE r.account_id = :recipientId
                            UNION ALL
                            SELECT :recipientId, NULL
                            WHERE NOT EXISTS (
                                SELECT 1 FROM notification_read_state r
                                WHERE r.account_id = :recipientId)
                        )
                        SELECT MAX(n.id) AS latest_id,
                               COALESCE(s.read_through_id, 0) AS read_through_id,
                               COUNT(CASE
                                   WHEN n.id > COALESCE(s.read_through_id, 0) THEN 1 END)
                                   AS unread_count
                        FROM state s
                        LEFT JOIN notifications n
                            ON n.recipient_account_id = s.recipient_account_id""")
                .param("recipientId", recipientId)
                .query((rs, rowNum) -> {
                    long latestId = rs.getLong("latest_id");
                    return new NotificationSummary(
                            rs.wasNull() ? null : latestId,
                            rs.getLong("read_through_id"),
                            rs.getLong("unread_count"));
                })
                .single();
    }

    public List<NotificationItem> findPage(
            long recipientId, int limit, Long beforeId, long readThroughId) {
        return jdbcClient
                .sql("""
                        SELECT n.id, n.type,
                               actor.display_name AS actor,
                               actor.handle AS actor_handle,
                               n.post_id, p.content AS post_content,
                               n.reply_id, r.content AS reply_content,
                               n.created_at,
                               n.id <= :readThroughId AS read
                        FROM notifications n
                        JOIN accounts actor ON actor.id = n.actor_account_id
                        JOIN posts p ON p.id = n.post_id
                        LEFT JOIN replies r ON r.id = n.reply_id
                        WHERE n.recipient_account_id = :recipientId
                          AND (:beforeId IS NULL OR n.id < :beforeId)
                        ORDER BY n.id DESC
                        LIMIT :limit""")
                .param("recipientId", recipientId)
                .param("beforeId", beforeId)
                .param("limit", limit)
                .param("readThroughId", readThroughId)
                .query(this::mapNotificationItem)
                .list();
    }

    private NotificationItem mapNotificationItem(ResultSet rs, int rowNum) throws SQLException {
        String createdAt = rs.getString("created_at");
        Instant instant = LocalDateTime.parse(createdAt, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC);
        long replyId = rs.getLong("reply_id");
        boolean replyIdWasNull = rs.wasNull();
        return new NotificationItem(
                rs.getLong("id"),
                NotificationType.valueOf(rs.getString("type")),
                rs.getString("actor"),
                rs.getString("actor_handle"),
                rs.getLong("post_id"),
                rs.getString("post_content"),
                replyIdWasNull ? null : replyId,
                rs.getString("reply_content"),
                instant,
                rs.getBoolean("read"));
    }
}
