package com.example.deck.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DatabaseConfigTest {

    @TempDir
    Path tempDir;

    @Test
    void replacementPhysicalConnectionReappliesConnectionLocalPragmas() throws Exception {
        DatabaseConfig config = new DatabaseConfig();
        try (HikariDataSource dataSource =
                (HikariDataSource) config.dataSource(tempDir.resolve("deck.db").toString())) {
            assertConnectionPragmas(dataSource);

            dataSource.getHikariPoolMXBean().softEvictConnections();

            assertConnectionPragmas(dataSource);
        }
    }

    private void assertConnectionPragmas(HikariDataSource dataSource) throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            assertThat(pragma(connection, "foreign_keys")).isEqualTo("1");
            assertThat(pragma(connection, "busy_timeout")).isEqualTo("5000");
            assertThat(pragma(connection, "journal_mode")).isEqualTo("wal");
        }
    }

    private String pragma(Connection connection, String name) throws Exception {
        try (Statement statement = connection.createStatement();
                ResultSet resultSet = statement.executeQuery("PRAGMA " + name)) {
            assertThat(resultSet.next()).isTrue();
            return resultSet.getString(1);
        }
    }
}
