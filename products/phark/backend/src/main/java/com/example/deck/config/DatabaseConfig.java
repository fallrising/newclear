package com.example.deck.config;

import com.zaxxer.hikari.HikariDataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import javax.sql.DataSource;
import org.sqlite.SQLiteConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.simple.JdbcClient;

@Configuration
public class DatabaseConfig {

    @Bean
    @Primary
    public DataSource dataSource(@Value("${app.db.path:./data/deck.db}") String dbPath) throws Exception {
        if (!":memory:".equals(dbPath)) {
            Path path = Path.of(dbPath);
            Path parent = path.getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
        }

        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:sqlite:" + dbPath);
        dataSource.setDriverClassName("org.sqlite.JDBC");
        dataSource.setMaximumPoolSize(1);
        SQLiteConfig sqliteConfig = new SQLiteConfig();
        sqliteConfig.enforceForeignKeys(true);
        sqliteConfig.setBusyTimeout(5000);
        dataSource.setDataSourceProperties(sqliteConfig.toProperties());

        applyPragmas(dataSource);
        return dataSource;
    }

    @Bean
    public JdbcClient jdbcClient(DataSource dataSource) {
        return JdbcClient.create(dataSource);
    }

    private void applyPragmas(DataSource dataSource) throws SQLException {
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            statement.execute("PRAGMA journal_mode=WAL");
        }
    }
}
