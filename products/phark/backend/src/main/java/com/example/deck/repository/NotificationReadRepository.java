package com.example.deck.repository;

import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class NotificationReadRepository {

    private final JdbcClient jdbcClient;

    public NotificationReadRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public long findReadThroughId(long accountId) {
        Long value = jdbcClient
                .sql("""
                        SELECT read_through_id FROM notification_read_state
                        WHERE account_id = :accountId""")
                .param("accountId", accountId)
                .query(Long.class)
                .optional()
                .orElse(0L);
        return value;
    }

    public long advanceReadThrough(long accountId, long requestedId) {
        jdbcClient
                .sql("""
                        INSERT INTO notification_read_state (account_id, read_through_id)
                        VALUES (:accountId, :requestedId)
                        ON CONFLICT(account_id) DO UPDATE SET
                            read_through_id = MAX(
                                notification_read_state.read_through_id,
                                excluded.read_through_id),
                            updated_at = CASE
                                WHEN excluded.read_through_id
                                    > notification_read_state.read_through_id
                                THEN datetime('now')
                                ELSE notification_read_state.updated_at END""")
                .param("accountId", accountId)
                .param("requestedId", requestedId)
                .update();
        return findReadThroughId(accountId);
    }

    public boolean isOwnedRetained(long recipientId, long notificationId) {
        Long count = jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM notifications
                        WHERE recipient_account_id = :recipientId
                          AND id = :notificationId""")
                .param("recipientId", recipientId)
                .param("notificationId", notificationId)
                .query(Long.class)
                .single();
        return count != null && count > 0;
    }
}
