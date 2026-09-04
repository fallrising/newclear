package com.example.deck.config;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HashSet;
import java.util.Set;
import javax.sql.DataSource;
import org.flywaydb.core.api.configuration.Configuration;
import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;

@org.springframework.context.annotation.Configuration
public class SchemaMigrationConfig {

    private static final Set<String> LEGACY_POST_COLUMNS =
            Set.of("id", "author", "content", "channel", "created_at");

    @Bean
    public FlywayMigrationStrategy guardedLegacyBaseline() {
        return flyway -> {
            Configuration configuration = flyway.getConfiguration();
            DataSource dataSource = configuration.getDataSource();
            boolean shouldBaseline;

            try (Connection connection = dataSource.getConnection()) {
                shouldBaseline = !tableExists(connection, configuration.getTable())
                        && hasLegacyPostSchema(connection);
            } catch (SQLException exception) {
                throw new IllegalStateException(
                        "Failed to inspect the database before migration", exception);
            }

            if (shouldBaseline) {
                flyway.baseline();
            }
            flyway.migrate();
        };
    }

    private boolean tableExists(Connection connection, String tableName) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("""
                SELECT COUNT(*)
                FROM sqlite_master
                WHERE type = 'table' AND name = ?""")) {
            statement.setString(1, tableName);
            try (ResultSet resultSet = statement.executeQuery()) {
                return resultSet.next() && resultSet.getLong(1) > 0;
            }
        }
    }

    private boolean hasLegacyPostSchema(Connection connection) throws SQLException {
        if (!tableExists(connection, "posts")) {
            return false;
        }

        Set<String> columns = new HashSet<>();
        try (Statement statement = connection.createStatement();
                ResultSet resultSet = statement.executeQuery("PRAGMA table_info(posts)")) {
            while (resultSet.next()) {
                columns.add(resultSet.getString("name"));
            }
        }
        return columns.equals(LEGACY_POST_COLUMNS);
    }
}
