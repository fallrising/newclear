package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGConnectionPoolDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
final class WorkerConnectionsTest {
    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17");

    private static PGConnectionPoolDataSource source() {
        PGConnectionPoolDataSource source = new PGConnectionPoolDataSource();
        source.setURL(POSTGRES.getJdbcUrl());
        source.setUser(POSTGRES.getUsername());
        source.setPassword(POSTGRES.getPassword());
        return source;
    }

    private static int pid(Connection connection) throws SQLException {
        try (var statement = connection.createStatement();
                var result = statement.executeQuery("SELECT pg_backend_pid()")) {
            result.next();
            return result.getInt(1);
        }
    }

    @Test
    void reusesPhysicalConnectionAndRollsBackUncommittedWork() throws Exception {
        try (WorkerConnections worker = new WorkerConnections(source())) {
            int original;
            try (Connection connection = worker.acquire()) {
                original = pid(connection);
                connection.setAutoCommit(false);
                try (var statement = connection.createStatement()) {
                    statement.execute("CREATE TABLE must_rollback (id INT)");
                }
            }
            try (Connection connection = worker.acquire()) {
                assertThat(pid(connection)).isEqualTo(original);
                assertThat(connection.getAutoCommit()).isTrue();
                try (var statement = connection.createStatement();
                        var result = statement.executeQuery("SELECT to_regclass('must_rollback')")) {
                    result.next();
                    assertThat(result.getString(1)).isNull();
                }
            }
        }
    }

    @Test
    void reconnectsOnlyAfterSurfacingBrokenConnectionFailure() throws Exception {
        try (WorkerConnections worker = new WorkerConnections(source())) {
            int original;
            try (Connection connection = worker.acquire()) {
                original = pid(connection);
                try (Connection admin = source().getConnection(); var statement = admin.createStatement()) {
                    statement.execute("SELECT pg_terminate_backend(" + original + ")");
                }
                assertThatThrownBy(() -> pid(connection)).isInstanceOf(SQLException.class);
            }
            try (Connection replacement = worker.acquire()) {
                assertThat(pid(replacement)).isNotEqualTo(original);
            }
        }
    }

    @Test
    void rejectsConcurrentOrNestedUseAndClosesPhysicalConnection() throws Exception {
        WorkerConnections worker = new WorkerConnections(source());
        int original;
        try (worker) {
            try (Connection connection = worker.acquire()) {
                original = pid(connection);
                assertThatThrownBy(worker::acquire).isInstanceOf(SQLException.class)
                        .hasMessageContaining("active transaction");
                try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
                    executor.submit(() -> assertThatThrownBy(worker::acquire)
                            .isInstanceOf(SQLException.class)
                            .hasMessageContaining("across threads")).get();
                }
            }
        }
        assertThatThrownBy(worker::acquire).isInstanceOf(SQLException.class)
                .hasMessageContaining("closed");
        try (Connection admin = source().getConnection(); var statement = admin.createStatement();
                var result = statement.executeQuery("SELECT count(*) FROM pg_stat_activity WHERE pid=" + original)) {
            result.next();
            assertThat(result.getInt(1)).isZero();
        }
    }
}
