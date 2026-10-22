package dev.ojbk.console.group;

import dev.ojbk.console.api.ApiException;
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * One PostgreSQL advisory key shared across console processes, plus a committed lease row that
 * keeps ordinary mutations fenced if the advisory session is lost mid-reset.
 */
@Component
public final class GroupMaintenanceFence {
    private final DataSource dataSource;
    private final JdbcClient jdbc;
    private final ThreadLocal<Gate> owned = new ThreadLocal<>();
    public GroupMaintenanceFence(DataSource dataSource, JdbcClient jdbc) {
        this.dataSource = dataSource; this.jdbc = jdbc;
    }
    // Outlives the 60 s reset deadline plus bounded Kafka calls; a crashed owner's lease then expires.
    private static final java.time.Duration LEASE_MARGIN = java.time.Duration.ofMinutes(5);
    private static long key(long group) { return group ^ 0x4f4a425100000000L; }

    public Gate acquire(long group, long deadline) {
        if (owned.get() != null) throw new IllegalStateException("nested maintenance is not supported");
        Connection connection = null;
        try {
            connection = dataSource.getConnection();
            while (System.nanoTime() < deadline) {
                try (var statement = connection.prepareStatement("SELECT pg_try_advisory_lock(?)")) {
                    statement.setLong(1, key(group));
                    try (var rows = statement.executeQuery()) {
                        if (rows.next() && rows.getBoolean(1)) {
                            java.util.UUID token = java.util.UUID.randomUUID();
                            if (!lease(connection, group, token, deadline)) {
                                unlock(connection, group);
                                throw busy();
                            }
                            Gate gate = new Gate(connection, group, deadline, token);
                            owned.set(gate);
                            return gate;
                        }
                    }
                }
                Thread.sleep(10);
            }
            throw busy();
        } catch (SQLException failure) { throw busy(); }
        catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw busy(); }
        finally {
            if (owned.get() == null && connection != null) {
                try { connection.close(); } catch (SQLException ignored) { }
            }
        }
    }

    /** Commits the lease on its own; an unexpired lease of a crashed owner keeps the group busy. */
    private static boolean lease(Connection connection, long group, java.util.UUID token, long deadline)
            throws SQLException {
        connection.setAutoCommit(true);
        try (var statement = connection.prepareStatement("""
                INSERT INTO group_maintenance_lease (group_id, token, expires_at)
                VALUES (?, ?, now() + make_interval(secs => ?))
                ON CONFLICT (group_id) DO UPDATE
                  SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
                  WHERE group_maintenance_lease.expires_at <= now()
                """)) {
            statement.setLong(1, group);
            statement.setObject(2, token);
            statement.setLong(3, Math.max(0, deadline - System.nanoTime()) / 1_000_000_000L
                    + LEASE_MARGIN.toSeconds());
            return statement.executeUpdate() == 1;
        }
    }

    private static void unlock(Connection connection, long group) throws SQLException {
        try (var statement = connection.prepareStatement("SELECT pg_advisory_unlock(?)")) {
            statement.setLong(1, key(group)); statement.execute();
        }
    }

    /** Called inside the existing mutation transaction; retained until commit/rollback. */
    public void mutation(long group) {
        Gate held = owned.get();
        if (held != null && held.group == group) { held.verifyOwned(); return; }
        if (!TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("subscription mutation requires a transaction");
        boolean acquired = jdbc.sql("SELECT pg_try_advisory_xact_lock(:key)")
                .param("key", key(group)).query(Boolean.class).single();
        if (!acquired) throw busy();
        boolean leased = jdbc.sql("""
                        SELECT EXISTS (SELECT 1 FROM group_maintenance_lease
                        WHERE group_id = :group AND expires_at > now())
                        """)
                .param("group", group).query(Boolean.class).single();
        if (leased) throw busy();
    }
    private static ApiException busy() {
        return new ApiException("GROUP_MAINTENANCE_IN_PROGRESS", HttpStatus.CONFLICT,
                "group state cannot change during an offset reset");
    }
    public final class Gate implements AutoCloseable {
        private final Connection connection;
        private final long group;
        private final long deadline;
        private final java.util.UUID token;
        private Gate(Connection connection, long group, long deadline, java.util.UUID token) {
            this.connection = connection; this.group = group; this.deadline = deadline; this.token = token;
        }
        public void verifyOwned() {
            if (owned.get() != this)
                throw new IllegalStateException("maintenance gate is not owned by this thread");
            // Inspect the same physical session; do not reacquire a silently lost lock.
            try (var statement = connection.prepareStatement("""
                    SELECT EXISTS (SELECT 1 FROM pg_locks
                    WHERE locktype = 'advisory' AND pid = pg_backend_pid()
                      AND objsubid = 1 AND classid::bigint = ? AND objid::bigint = ? AND granted)
                    """)) {
                statement.setLong(1, key(group) >>> 32);
                statement.setLong(2, key(group) & 0xffffffffL);
                statement.setQueryTimeout((int) Math.max(1, Math.min(60,
                        (deadline - System.nanoTime() + 999_999_999L) / 1_000_000_000L)));
                try (var rows = statement.executeQuery()) {
                    if (!rows.next() || !rows.getBoolean(1)) throw busy();
                }
            } catch (SQLException failure) { throw busy(); }
        }
        public void close() {
            IllegalStateException failure = null;
            try { unlock(connection, group); }
            catch (SQLException unlockFailure) {
                // Never return a pooled physical session carrying an advisory lock.
                try { connection.abort(Runnable::run); } catch (SQLException suppressed) { unlockFailure.addSuppressed(suppressed); }
                failure = new IllegalStateException("group maintenance lock could not be released", unlockFailure);
            } finally {
                owned.remove();
                try { connection.close(); } catch (SQLException closeFailure) {
                    if (failure == null) failure = new IllegalStateException("maintenance connection could not close", closeFailure);
                }
            }
            // A fresh pooled session: the lease must go even when the advisory session is gone.
            try {
                jdbc.sql("DELETE FROM group_maintenance_lease WHERE group_id = :group AND token = :token")
                        .param("group", group).param("token", token).update();
            } catch (RuntimeException leaseFailure) {
                if (failure == null) failure = new IllegalStateException("maintenance lease kept until expiry", leaseFailure);
                else failure.addSuppressed(leaseFailure);
            }
            if (failure != null) throw failure;
        }
    }
}
