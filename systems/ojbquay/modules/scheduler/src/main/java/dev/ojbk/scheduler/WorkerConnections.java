package dev.ojbk.scheduler;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Objects;
import javax.sql.ConnectionEvent;
import javax.sql.ConnectionEventListener;
import javax.sql.ConnectionPoolDataSource;
import javax.sql.PooledConnection;

/** One physical connection per fixed worker, with JDBC logical transaction handles. */
final class WorkerConnections implements AutoCloseable {
    private final ConnectionPoolDataSource source;
    private PooledConnection pooled;
    private Thread owner;
    private volatile boolean active;
    private volatile boolean broken;
    private boolean closed;
    private long generation;

    WorkerConnections(ConnectionPoolDataSource source) {
        this.source = Objects.requireNonNull(source, "source");
    }

    synchronized Connection acquire() throws SQLException {
        if (closed) {
            throw new SQLException("worker connection is closed");
        }
        if (owner == null) {
            owner = Thread.currentThread();
        } else if (owner != Thread.currentThread()) {
            throw new SQLException("worker connection cannot be shared across threads");
        }
        if (active) {
            throw new SQLException("worker connection already has an active transaction handle");
        }
        if (broken && pooled != null) {
            try {
                pooled.close();
            } finally {
                pooled = null;
            }
        }
        if (pooled == null) {
            pooled = source.getPooledConnection();
            generation++;
            broken = false;
            pooled.addConnectionEventListener(new ConnectionEventListener() {
                @Override
                public void connectionClosed(ConnectionEvent event) {
                    active = false;
                }

                @Override
                public void connectionErrorOccurred(ConnectionEvent event) {
                    broken = true;
                    active = false;
                }
            });
        }
        try {
            Connection connection = pooled.getConnection();
            active = true;
            return connection;
        } catch (SQLException failure) {
            broken = true;
            throw failure;
        }
    }

    synchronized long generation() {
        return generation;
    }

    @Override
    public synchronized void close() {
        if (closed) {
            return;
        }
        closed = true;
        if (pooled != null) {
            try {
                pooled.close();
            } catch (SQLException failure) {
                throw new IllegalStateException("worker connection close failed", failure);
            }
        }
    }
}
