package dev.ojbk.scheduler;

import dev.ojbk.delay.DelayAction;
import dev.ojbk.delay.DelayCommand;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import javax.sql.DataSource;

public final class JdbcDelayRepository implements DelayRepository {
    public static final int MAX_BATCH = 500;

    private static final String INSERT = """
            INSERT INTO delay_message (
              delay_id, target_topic, due_at, payload, headers, msg_key,
              loop_interval_ms, loop_remaining, expire_at, status
            )
            VALUES (?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?)
            ON CONFLICT (delay_id) DO NOTHING
            """;
    private static final String CANCEL = """
            UPDATE delay_message
               SET status = ?, fired_at = now()
             WHERE delay_id = ? AND target_topic = ? AND status = ?
            """;
    private static final String CLAIM_DUE = """
            SELECT delay_id, target_topic, due_at, payload, headers, msg_key,
                   loop_interval_ms, loop_remaining, expire_at
              FROM delay_message
             WHERE status = ? AND due_at <= ?
             ORDER BY due_at, delay_id
             LIMIT ?
             FOR UPDATE SKIP LOCKED
            """;
    private static final String TERMINATE = """
            UPDATE delay_message
               SET status = ?, fired_at = ?
             WHERE delay_id = ? AND status = ?
            """;
    private static final String ADVANCE = """
            UPDATE delay_message
               SET due_at = ?, loop_remaining = ?, fired_at = NULL
             WHERE delay_id = ? AND status = ?
            """;
    private static final String CLEANUP = """
            WITH doomed AS (
              SELECT delay_id
                FROM delay_message
               WHERE status <> ? AND COALESCE(fired_at, created_at) < ?
               ORDER BY COALESCE(fired_at, created_at), delay_id
               LIMIT ?
               FOR UPDATE SKIP LOCKED
            )
            DELETE FROM delay_message existing
             USING doomed
             WHERE existing.delay_id = doomed.delay_id
            """;
    private static final String PENDING_COUNT =
            "SELECT count(*) FROM delay_message WHERE status = ?";

    private final DataSource dataSource;
    private final DelayMetadataCodec metadata = new DelayMetadataCodec();

    public JdbcDelayRepository(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }

    @Override
    public void applyBatch(List<DelayCommand> commands) {
        List<DelayCommand> batch = bounded(commands);
        if (batch.isEmpty()) {
            return;
        }
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                for (DelayCommand command : batch) {
                    if (command.action() == DelayAction.ADD) {
                        insert(connection, command);
                    } else {
                        cancel(connection, command);
                    }
                }
                connection.commit();
            } catch (SQLException | RuntimeException failure) {
                rollback(connection, failure);
                throw failure;
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("delay command transaction failed", failure);
        }
    }

    @Override
    public int dispatchDue(Instant now, int limit, DelaySender sender) {
        Objects.requireNonNull(now, "now");
        Objects.requireNonNull(sender, "sender");
        validateLimit(limit);
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                List<StoredDelay> due = claim(connection, now, limit);
                int dispatched = 0;
                for (StoredDelay delay : due) {
                    if (isExpired(delay, now)) {
                        terminate(connection, delay.delayId(), DelayStatus.EXPIRED, now);
                        continue;
                    }
                    sender.send(delay.delivery());
                    dispatched++;
                    completeOccurrence(connection, delay, now);
                }
                connection.commit();
                return dispatched;
            } catch (SQLException failure) {
                rollback(connection, failure);
                throw new IllegalStateException("delay dispatch transaction failed", failure);
            } catch (RuntimeException failure) {
                rollback(connection, failure);
                throw new DelayDispatchException("delay send failed; state was rolled back", failure);
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("delay dispatch transaction failed", failure);
        }
    }

    @Override
    public int cleanupTerminal(Instant before, int limit) {
        Objects.requireNonNull(before, "before");
        validateLimit(limit);
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(CLEANUP)) {
            statement.setShort(1, DelayStatus.PENDING.code());
            statement.setTimestamp(2, Timestamp.from(before));
            statement.setInt(3, limit);
            return statement.executeUpdate();
        } catch (SQLException failure) {
            throw new IllegalStateException("delay cleanup failed", failure);
        }
    }

    @Override
    public long pendingCount() {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement = connection.prepareStatement(PENDING_COUNT)) {
            statement.setShort(1, DelayStatus.PENDING.code());
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        } catch (SQLException failure) {
            throw new IllegalStateException("pending delay count failed", failure);
        }
    }

    private void insert(Connection connection, DelayCommand command) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(INSERT)) {
            statement.setString(1, command.delayId());
            statement.setString(2, command.targetTopic());
            statement.setTimestamp(3, Timestamp.from(Instant.ofEpochMilli(command.dueAtMs())));
            statement.setBytes(4, command.value());
            statement.setString(
                    5,
                    metadata.encode(command.tags(), command.headers(), command.partition()));
            statement.setString(6, command.key());
            if (command.loopIntervalMs() == null) {
                statement.setNull(7, java.sql.Types.BIGINT);
            } else {
                statement.setLong(7, command.loopIntervalMs());
            }
            statement.setInt(8, command.loopRemaining());
            if (command.expireAtMs() == null) {
                statement.setNull(9, java.sql.Types.TIMESTAMP_WITH_TIMEZONE);
            } else {
                statement.setTimestamp(
                        9, Timestamp.from(Instant.ofEpochMilli(command.expireAtMs())));
            }
            statement.setShort(10, DelayStatus.PENDING.code());
            statement.executeUpdate();
        }
    }

    private static void cancel(Connection connection, DelayCommand command) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(CANCEL)) {
            statement.setShort(1, DelayStatus.CANCELED.code());
            statement.setString(2, command.delayId());
            statement.setString(3, command.targetTopic());
            statement.setShort(4, DelayStatus.PENDING.code());
            statement.executeUpdate();
        }
    }

    private List<StoredDelay> claim(Connection connection, Instant now, int limit)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(CLAIM_DUE)) {
            statement.setShort(1, DelayStatus.PENDING.code());
            statement.setTimestamp(2, Timestamp.from(now));
            statement.setInt(3, limit);
            try (ResultSet result = statement.executeQuery()) {
                List<StoredDelay> delays = new ArrayList<>();
                while (result.next()) {
                    long interval = result.getLong("loop_interval_ms");
                    Long loopIntervalMs = result.wasNull() ? null : interval;
                    Timestamp expiration = result.getTimestamp("expire_at");
                    var storedMetadata = metadata.decode(result.getString("headers"));
                    delays.add(new StoredDelay(
                            result.getString("delay_id"),
                            result.getTimestamp("due_at").toInstant(),
                            loopIntervalMs,
                            result.getInt("loop_remaining"),
                            expiration == null ? null : expiration.toInstant(),
                            new DelayDelivery(
                                    result.getString("delay_id"),
                                    result.getString("target_topic"),
                                    result.getTimestamp("due_at").toInstant(),
                                    result.getBytes("payload"),
                                    result.getString("msg_key"),
                                    storedMetadata.tags(),
                                    storedMetadata.headers(),
                                    storedMetadata.partition())));
                }
                return List.copyOf(delays);
            }
        }
    }

    private static boolean isExpired(StoredDelay delay, Instant now) {
        return delay.expireAt() != null && !delay.expireAt().isAfter(now);
    }

    private static void completeOccurrence(
            Connection connection, StoredDelay delay, Instant now) throws SQLException {
        if (delay.loopRemaining() <= 1) {
            terminate(connection, delay.delayId(), DelayStatus.DONE, now);
            return;
        }
        if (delay.loopIntervalMs() == null) {
            throw new IllegalStateException("recurring delay has no interval");
        }
        Instant nextDue = delay.dueAt().plusMillis(delay.loopIntervalMs());
        if (delay.expireAt() != null && !nextDue.isBefore(delay.expireAt())) {
            terminate(connection, delay.delayId(), DelayStatus.EXPIRED, now);
            return;
        }
        try (PreparedStatement statement = connection.prepareStatement(ADVANCE)) {
            statement.setTimestamp(1, Timestamp.from(nextDue));
            statement.setInt(2, delay.loopRemaining() - 1);
            statement.setString(3, delay.delayId());
            statement.setShort(4, DelayStatus.PENDING.code());
            statement.executeUpdate();
        }
    }

    private static void terminate(
            Connection connection, String delayId, DelayStatus status, Instant now)
            throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(TERMINATE)) {
            statement.setShort(1, status.code());
            statement.setTimestamp(2, Timestamp.from(now));
            statement.setString(3, delayId);
            statement.setShort(4, DelayStatus.PENDING.code());
            statement.executeUpdate();
        }
    }

    private static List<DelayCommand> bounded(List<DelayCommand> commands) {
        List<DelayCommand> batch = List.copyOf(Objects.requireNonNull(commands, "commands"));
        if (batch.size() > MAX_BATCH) {
            throw new IllegalArgumentException("delay command batch exceeds 500");
        }
        return batch;
    }

    private static void validateLimit(int limit) {
        if (limit < 1 || limit > MAX_BATCH) {
            throw new IllegalArgumentException("delay batch limit must be 1..500");
        }
    }

    private static void rollback(Connection connection, Throwable original) {
        try {
            connection.rollback();
        } catch (SQLException rollbackFailure) {
            original.addSuppressed(rollbackFailure);
        }
    }

    private record StoredDelay(
            String delayId,
            Instant dueAt,
            Long loopIntervalMs,
            int loopRemaining,
            Instant expireAt,
            DelayDelivery delivery) {}
}
