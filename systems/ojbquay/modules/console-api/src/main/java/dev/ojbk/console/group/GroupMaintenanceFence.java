package dev.ojbk.console.group;

import dev.ojbk.console.api.ApiException;
import java.sql.Connection;
import java.sql.SQLException;
import javax.sql.DataSource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** One PostgreSQL advisory key shared across console processes; no schema or gateway DB access. */
@Component
public final class GroupMaintenanceFence {
    private final DataSource dataSource;
    private final JdbcClient jdbc;
    private final ThreadLocal<Gate> owned = new ThreadLocal<>();
    public GroupMaintenanceFence(DataSource dataSource, JdbcClient jdbc) {
        this.dataSource = dataSource; this.jdbc = jdbc;
    }
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
                            Gate gate = new Gate(connection, group, deadline);
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

    /** Called inside the existing mutation transaction; retained until commit/rollback. */
    public void mutation(long group) {
        Gate held = owned.get();
        if (held != null && held.group == group) { held.verifyOwned(); return; }
        if (!TransactionSynchronizationManager.isActualTransactionActive())
            throw new IllegalStateException("subscription mutation requires a transaction");
        boolean acquired = jdbc.sql("SELECT pg_try_advisory_xact_lock(:key)")
                .param("key", key(group)).query(Boolean.class).single();
        if (!acquired) throw busy();
    }
    private static ApiException busy() {
        return new ApiException("GROUP_MAINTENANCE_IN_PROGRESS", HttpStatus.CONFLICT,
                "group state cannot change during an offset reset");
    }
    public final class Gate implements AutoCloseable {
        private final Connection connection;
        private final long group;
        private final long deadline;
        private Gate(Connection connection, long group, long deadline) {
            this.connection = connection; this.group = group; this.deadline = deadline;
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
            try (var statement = connection.prepareStatement("SELECT pg_advisory_unlock(?)")) {
                statement.setLong(1, key(group)); statement.execute();
            } catch (SQLException failure) {
                // Never return a pooled physical session carrying an advisory lock.
                try { connection.abort(Runnable::run); } catch (SQLException suppressed) { failure.addSuppressed(suppressed); }
                throw new IllegalStateException("group maintenance lock could not be released", failure);
            } finally {
                owned.remove();
                try { connection.close(); } catch (SQLException failure) {
                    throw new IllegalStateException("maintenance connection could not close", failure);
                }
            }
        }
    }
}
