package com.example.deck.repository;

import com.example.deck.model.Post;
import com.example.deck.model.PostImage;
import com.example.deck.model.SearchCursor;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class SearchRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private static final String VIEWER_LIKED = """
            EXISTS(
                SELECT 1 FROM post_likes viewer_like
                WHERE viewer_like.post_id = p.id
                  AND viewer_like.account_id = :viewerAccountId
            )""";
    private static final String VIEWER_REPOSTED = """
            EXISTS(
                SELECT 1 FROM post_reposts viewer_repost
                WHERE viewer_repost.post_id = p.id
                  AND viewer_repost.account_id = :viewerAccountId
            )""";

    private static final String SEARCH_SELECT = """
            SELECT p.id, COALESCE(a.display_name, p.author) AS author,
                   a.handle AS author_handle, p.content, p.channel, p.created_at,
                   (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count,
                   (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
                   %s AS liked_by_viewer,
                   (SELECT COUNT(*) FROM post_reposts pr WHERE pr.post_id = p.id)
                       AS repost_count,
                   %s AS reposted_by_viewer,
                   'post:' || p.id AS timeline_entry_id,
                   NULL AS reposted_by,
                   NULL AS reposted_by_handle,
                   NULL AS reposted_at,
                   im.id AS image_id,
                   im.content_type AS image_content_type,
                   im.width AS image_width,
                   im.height AS image_height,
                   im.byte_size AS image_byte_size
            FROM search_posts sp
            JOIN posts p ON p.id = sp.rowid
            LEFT JOIN accounts a ON a.id = p.author_account_id
            LEFT JOIN post_images im ON im.post_id = p.id
            WHERE search_posts MATCH :query""";

    private final JdbcClient jdbcClient;

    public SearchRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Post> findResults(
            String compiledQuery,
            Long viewerAccountId,
            SearchCursor before,
            int fetchLimit) {
        String likedExpression = viewerAccountId == null ? "0" : VIEWER_LIKED;
        String repostedExpression = viewerAccountId == null ? "0" : VIEWER_REPOSTED;
        StringBuilder sql = new StringBuilder(
                SEARCH_SELECT.formatted(likedExpression, repostedExpression));
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("query", compiledQuery);
        parameters.put("fetchLimit", fetchLimit);

        if (viewerAccountId != null) {
            parameters.put("viewerAccountId", viewerAccountId);
        }

        if (before != null) {
            sql.append(" AND (p.created_at < :beforeCreatedAt"
                    + " OR (p.created_at = :beforeCreatedAt AND p.id < :beforeId))");
            parameters.put(
                    "beforeCreatedAt",
                    LocalDateTime.ofInstant(before.createdAt(), ZoneOffset.UTC)
                            .format(SQLITE_DATETIME));
            parameters.put("beforeId", before.id());
        }

        sql.append("""
                 ORDER BY p.created_at DESC, p.id DESC
                LIMIT :fetchLimit""");

        return jdbcClient
                .sql(sql.toString())
                .params(parameters)
                .query(this::mapPost)
                .list();
    }

    private Post mapPost(ResultSet rs, int rowNum) throws SQLException {
        String repostedAt = rs.getString("reposted_at");
        return new Post(
                rs.getLong("id"),
                rs.getString("author"),
                rs.getString("author_handle"),
                rs.getString("content"),
                rs.getString("channel"),
                parseInstant(rs.getString("created_at")),
                rs.getLong("reply_count"),
                rs.getLong("like_count"),
                rs.getBoolean("liked_by_viewer"),
                rs.getString("timeline_entry_id"),
                rs.getLong("repost_count"),
                rs.getBoolean("reposted_by_viewer"),
                rs.getString("reposted_by"),
                rs.getString("reposted_by_handle"),
                repostedAt == null ? null : parseInstant(repostedAt),
                mapPostImage(rs));
    }

    private PostImage mapPostImage(ResultSet rs) throws SQLException {
        long imageId = rs.getLong("image_id");
        if (rs.wasNull()) {
            return null;
        }
        return PostImage.of(
                imageId,
                rs.getString("image_content_type"),
                rs.getInt("image_width"),
                rs.getInt("image_height"),
                rs.getLong("image_byte_size"));
    }

    private Instant parseInstant(String value) {
        return LocalDateTime.parse(value, SQLITE_DATETIME).toInstant(ZoneOffset.UTC);
    }
}