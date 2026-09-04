package com.example.deck.repository;

import com.example.deck.model.PostCursor;
import com.example.deck.model.Reply;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class ReplyRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcClient jdbcClient;

    public ReplyRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Reply> findPage(long postId, int fetchLimit, PostCursor after) {
        StringBuilder sql = new StringBuilder("""
                SELECT r.id, r.post_id, COALESCE(a.display_name, r.author) AS author,
                       a.handle AS author_handle, r.content, r.created_at
                FROM replies r
                LEFT JOIN accounts a ON a.id = r.author_account_id
                WHERE r.post_id = :postId""");
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("postId", postId);

        if (after != null) {
            sql.append("""
                     AND (
                        r.created_at > :afterCreatedAt
                        OR (r.created_at = :afterCreatedAt AND r.id > :afterId)
                    )""");
            parameters.put(
                    "afterCreatedAt",
                    LocalDateTime.ofInstant(after.createdAt(), ZoneOffset.UTC)
                            .format(SQLITE_DATETIME));
            parameters.put("afterId", after.id());
        }

        sql.append(" ORDER BY r.created_at ASC, r.id ASC LIMIT :fetchLimit");
        parameters.put("fetchLimit", fetchLimit);

        return jdbcClient
                .sql(sql.toString())
                .params(parameters)
                .query(this::mapReply)
                .list();
    }

    public Reply insert(long postId, String author, String content) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcClient
                .sql("""
                        INSERT INTO replies (post_id, author, content)
                        VALUES (:postId, :author, :content)""")
                .param("postId", postId)
                .param("author", author)
                .param("content", content)
                .update(keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated reply id");
        }

        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Failed to load inserted reply"));
    }

    public Reply insertOwned(long postId, long accountId, String content) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        int inserted = jdbcClient
                .sql("""
                        INSERT INTO replies (post_id, author, content, author_account_id)
                        SELECT :postId, display_name, :content, id
                        FROM accounts
                        WHERE id = :accountId""")
                .param("postId", postId)
                .param("content", content)
                .param("accountId", accountId)
                .update(keyHolder);

        if (inserted != 1) {
            throw new IllegalArgumentException("Account not found");
        }
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated reply id");
        }
        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Failed to load inserted reply"));
    }

    public Optional<Reply> findById(long id) {
        return jdbcClient
                .sql("""
                        SELECT r.id, r.post_id, COALESCE(a.display_name, r.author) AS author,
                               a.handle AS author_handle, r.content, r.created_at
                        FROM replies r
                        LEFT JOIN accounts a ON a.id = r.author_account_id
                        WHERE r.id = :id""")
                .param("id", id)
                .query(this::mapReply)
                .optional();
    }

    private Reply mapReply(ResultSet rs, int rowNum) throws SQLException {
        String createdAt = rs.getString("created_at");
        Instant instant = LocalDateTime.parse(createdAt, SQLITE_DATETIME)
                .toInstant(ZoneOffset.UTC);
        return new Reply(
                rs.getLong("id"),
                rs.getLong("post_id"),
                rs.getString("author"),
                rs.getString("author_handle"),
                rs.getString("content"),
                instant);
    }
}
