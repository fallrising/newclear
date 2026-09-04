package com.example.deck.repository;

import com.example.deck.model.Account;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class AccountRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String SELECT_ACCOUNT = """
            SELECT id, handle, display_name, bio, password_hash, created_at, updated_at
            FROM accounts""";

    private final JdbcClient jdbcClient;

    public AccountRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public Account insert(String handle, String displayName, String passwordHash) {
        return insert(handle, displayName, passwordHash, "");
    }

    public Account insert(String handle, String displayName, String passwordHash, String bio) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcClient
                .sql("""
                        INSERT INTO accounts (handle, display_name, password_hash, bio)
                        VALUES (?, ?, ?, ?)""")
                .param(handle)
                .param(displayName)
                .param(passwordHash)
                .param(bio)
                .update(keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated account id");
        }

        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Failed to load inserted account"));
    }

    public Optional<Account> findById(long id) {
        return jdbcClient
                .sql(SELECT_ACCOUNT + " WHERE id = :id")
                .param("id", id)
                .query(this::mapAccount)
                .optional();
    }

    public Optional<Account> findByHandle(String handle) {
        return jdbcClient
                .sql(SELECT_ACCOUNT + " WHERE handle = :handle")
                .param("handle", handle)
                .query(this::mapAccount)
                .optional();
    }

    public Account updateProfile(long id, String displayName, String bio) {
        int updated = jdbcClient
                .sql("""
                        UPDATE accounts
                        SET display_name = :displayName, bio = :bio, updated_at = datetime('now')
                        WHERE id = :id""")
                .param("displayName", displayName)
                .param("bio", bio)
                .param("id", id)
                .update();

        if (updated == 0) {
            throw new IllegalArgumentException("Account not found: " + id);
        }

        return findById(id)
                .orElseThrow(() -> new IllegalStateException("Failed to load updated account"));
    }

    private Account mapAccount(ResultSet rs, int rowNum) throws SQLException {
        String createdAt = rs.getString("created_at");
        Instant createdAtInstant = LocalDateTime.parse(createdAt, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC);
        String updatedAt = rs.getString("updated_at");
        Instant updatedAtInstant = LocalDateTime.parse(updatedAt, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC);
        return new Account(
                rs.getLong("id"),
                rs.getString("handle"),
                rs.getString("display_name"),
                rs.getString("bio"),
                rs.getString("password_hash"),
                createdAtInstant,
                updatedAtInstant);
    }
}
