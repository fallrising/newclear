package com.example.deck.repository;

import com.example.deck.model.StoredPostImage;
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
public class PostImageRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final String SELECT = """
            SELECT id, post_id, storage_key, content_type,
                   byte_size, width, height, sha256, created_at
            FROM post_images""";

    private final JdbcClient jdbcClient;

    public PostImageRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public long insert(
            long postId,
            String storageKey,
            String contentType,
            long byteSize,
            int width,
            int height,
            String sha256) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcClient
                .sql("""
                        INSERT INTO post_images
                            (post_id, storage_key, content_type,
                             byte_size, width, height, sha256)
                        VALUES (:postId, :storageKey, :contentType,
                                :byteSize, :width, :height, :sha256)""")
                .param("postId", postId)
                .param("storageKey", storageKey)
                .param("contentType", contentType)
                .param("byteSize", byteSize)
                .param("width", width)
                .param("height", height)
                .param("sha256", sha256)
                .update(keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated post image id");
        }
        return key.longValue();
    }

    public Optional<StoredPostImage> findPositiveId(long id) {
        return jdbcClient
                .sql(SELECT + " WHERE id = :id")
                .param("id", id)
                .query(this::mapStoredPostImage)
                .optional();
    }

    public Optional<StoredPostImage> findByPostId(long postId) {
        return jdbcClient
                .sql(SELECT + " WHERE post_id = :postId")
                .param("postId", postId)
                .query(this::mapStoredPostImage)
                .optional();
    }

    private StoredPostImage mapStoredPostImage(ResultSet rs, int rowNum) throws SQLException {
        return new StoredPostImage(
                rs.getLong("id"),
                rs.getLong("post_id"),
                rs.getString("storage_key"),
                rs.getString("content_type"),
                rs.getLong("byte_size"),
                rs.getInt("width"),
                rs.getInt("height"),
                rs.getString("sha256"),
                parseInstant(rs.getString("created_at")));
    }

    private Instant parseInstant(String value) {
        return LocalDateTime.parse(value, SQLITE_DATETIME).toInstant(ZoneOffset.UTC);
    }
}