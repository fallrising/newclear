package com.example.deck.repository;

import com.example.deck.model.Post;
import com.example.deck.model.PostCursor;
import com.example.deck.model.PostImage;
import com.example.deck.model.TimelineEntryKind;
import com.example.deck.model.TimelinePost;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class PostRepository {

    private static final DateTimeFormatter SQLITE_DATETIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
    private static final String ORIGINAL_POST_SELECT = """
            SELECT p.id, COALESCE(a.display_name, p.author) AS author,
                   a.handle AS author_handle, p.content, p.channel, p.created_at,
                   (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count,
                   (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
                   0 AS liked_by_viewer,
                   (SELECT COUNT(*) FROM post_reposts pr WHERE pr.post_id = p.id)
                       AS repost_count,
                   0 AS reposted_by_viewer,
                   'post:' || p.id AS timeline_entry_id,
                   NULL AS reposted_by,
                   NULL AS reposted_by_handle,
                   NULL AS reposted_at,
                   im.id AS image_id,
                   im.content_type AS image_content_type,
                   im.width AS image_width,
                   im.height AS image_height,
                   im.byte_size AS image_byte_size
            FROM posts p
            LEFT JOIN accounts a ON a.id = p.author_account_id
            LEFT JOIN post_images im ON im.post_id = p.id""";
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
    private static final String TIMELINE_SELECT = """
            SELECT p.id, COALESCE(author.display_name, p.author) AS author,
                   author.handle AS author_handle, p.content, p.channel, p.created_at,
                   (SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count,
                   (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
                   %s AS liked_by_viewer,
                   (SELECT COUNT(*) FROM post_reposts pr WHERE pr.post_id = p.id)
                       AS repost_count,
                   %s AS reposted_by_viewer,
                   activity.timeline_entry_id, activity.reposted_by,
                   activity.reposted_by_handle, activity.reposted_at,
                   activity.activity_at, activity.entry_kind, activity.entry_id,
                   im.id AS image_id,
                   im.content_type AS image_content_type,
                   im.width AS image_width,
                   im.height AS image_height,
                   im.byte_size AS image_byte_size
            FROM (
                SELECT original.id AS post_id,
                       'post:' || original.id AS timeline_entry_id,
                       original.created_at AS activity_at,
                       %d AS entry_kind,
                       original.id AS entry_id,
                       original.author_account_id AS profile_account_id,
                       NULL AS reposted_by,
                       NULL AS reposted_by_handle,
                       NULL AS reposted_at
                FROM posts original
                UNION ALL
                SELECT repost.post_id,
                       'repost:' || repost.id AS timeline_entry_id,
                       repost.created_at AS activity_at,
                       %d AS entry_kind,
                       repost.id AS entry_id,
                       repost.account_id AS profile_account_id,
                       reposter.display_name AS reposted_by,
                       reposter.handle AS reposted_by_handle,
                       repost.created_at AS reposted_at
                FROM post_reposts repost
                JOIN accounts reposter ON reposter.id = repost.account_id
            ) activity
            JOIN posts p ON p.id = activity.post_id
            LEFT JOIN accounts author ON author.id = p.author_account_id
            LEFT JOIN post_images im ON im.post_id = p.id""";

    private final JdbcClient jdbcClient;

    public PostRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public List<Post> findPage(String channel, int fetchLimit, PostCursor before) {
        return posts(findTimelinePage(channel, fetchLimit, before, null));
    }

    public List<Post> findPage(
            String channel,
            int fetchLimit,
            PostCursor before,
            Long viewerAccountId) {
        return posts(findTimelinePage(channel, fetchLimit, before, viewerAccountId));
    }

    public List<Post> findPageByAccountId(
            long accountId,
            int fetchLimit,
            PostCursor before) {
        return posts(findTimelinePageByAccountId(accountId, fetchLimit, before, null));
    }

    public List<Post> findPageByAccountId(
            long accountId,
            int fetchLimit,
            PostCursor before,
            Long viewerAccountId) {
        return posts(findTimelinePageByAccountId(
                accountId, fetchLimit, before, viewerAccountId));
    }

    public List<TimelinePost> findTimelinePage(
            String channel,
            int fetchLimit,
            PostCursor before,
            Long viewerAccountId) {
        return findTimelinePage(channel, null, fetchLimit, before, viewerAccountId);
    }

    public List<TimelinePost> findTimelinePageByAccountId(
            long accountId,
            int fetchLimit,
            PostCursor before,
            Long viewerAccountId) {
        return findTimelinePage(null, accountId, fetchLimit, before, viewerAccountId);
    }

    private List<TimelinePost> findTimelinePage(
            String channel,
            Long profileAccountId,
            int fetchLimit,
            PostCursor before,
            Long viewerAccountId) {
        String likedExpression = viewerAccountId == null ? "0" : VIEWER_LIKED;
        String repostedExpression = viewerAccountId == null ? "0" : VIEWER_REPOSTED;
        StringBuilder sql = new StringBuilder(TIMELINE_SELECT.formatted(
                likedExpression,
                repostedExpression,
                TimelineEntryKind.POST.sortOrder(),
                TimelineEntryKind.REPOST.sortOrder()));
        List<String> predicates = new ArrayList<>();
        Map<String, Object> parameters = new HashMap<>();

        if (viewerAccountId != null) {
            parameters.put("viewerAccountId", viewerAccountId);
        }

        if (channel != null) {
            predicates.add("p.channel = :channel");
            parameters.put("channel", channel);
        }
        if (profileAccountId != null) {
            predicates.add("activity.profile_account_id = :accountId");
            parameters.put("accountId", profileAccountId);
        }
        if (before != null) {
            predicates.add("""
                    (activity.activity_at < :beforeCreatedAt
                        OR (activity.activity_at = :beforeCreatedAt
                            AND activity.entry_kind < :beforeEntryKind)
                        OR (activity.activity_at = :beforeCreatedAt
                            AND activity.entry_kind = :beforeEntryKind
                            AND activity.entry_id < :beforeEntryId))""");
            parameters.put(
                    "beforeCreatedAt",
                    LocalDateTime.ofInstant(before.createdAt(), ZoneOffset.UTC)
                            .format(SQLITE_DATETIME));
            parameters.put("beforeEntryKind", before.entryKind().sortOrder());
            parameters.put("beforeEntryId", before.id());
        }
        if (!predicates.isEmpty()) {
            sql.append(" WHERE ").append(String.join(" AND ", predicates));
        }

        sql.append(' ').append("""
                ORDER BY activity.activity_at DESC,
                         activity.entry_kind DESC,
                         activity.entry_id DESC
                LIMIT :fetchLimit""");
        parameters.put("fetchLimit", fetchLimit);

        return jdbcClient
                .sql(sql.toString())
                .params(parameters)
                .query(this::mapTimelinePost)
                .list();
    }

    private List<Post> posts(List<TimelinePost> timelinePosts) {
        return timelinePosts.stream().map(TimelinePost::post).toList();
    }

    public long count() {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM posts")
                .query(Long.class)
                .single();
    }

    public Post insert(String author, String content, String channel) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        jdbcClient
                .sql("INSERT INTO posts (author, content, channel) VALUES (?, ?, ?)")
                .param(author)
                .param(content)
                .param(channel)
                .update(keyHolder);

        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated post id");
        }

        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Failed to load inserted post"));
    }

    public Post insertOwned(long accountId, String content, String channel) {
        KeyHolder keyHolder = new GeneratedKeyHolder();
        int inserted = jdbcClient
                .sql("""
                        INSERT INTO posts (author, content, channel, author_account_id)
                        SELECT display_name, :content, :channel, id
                        FROM accounts
                        WHERE id = :accountId""")
                .param("content", content)
                .param("channel", channel)
                .param("accountId", accountId)
                .update(keyHolder);

        if (inserted != 1) {
            throw new IllegalArgumentException("Account not found");
        }
        Number key = keyHolder.getKey();
        if (key == null) {
            throw new IllegalStateException("Failed to retrieve generated post id");
        }
        return findById(key.longValue())
                .orElseThrow(() -> new IllegalStateException("Failed to load inserted post"));
    }

    public Optional<Post> findById(long id) {
        return jdbcClient
                .sql(ORIGINAL_POST_SELECT + " WHERE p.id = :id")
                .param("id", id)
                .query(this::mapPost)
                .optional();
    }

    public boolean existsById(long id) {
        Long count = jdbcClient
                .sql("SELECT COUNT(*) FROM posts WHERE id = :id")
                .param("id", id)
                .query(Long.class)
                .single();
        return count > 0;
    }

    public Optional<Long> findAuthorAccountId(long postId) {
        return jdbcClient
                .sql("""
                        SELECT author_account_id FROM posts
                        WHERE id = :postId AND author_account_id IS NOT NULL""")
                .param("postId", postId)
                .query(Long.class)
                .optional();
    }

    public void insertSeed(String author, String content, String channel) {
        jdbcClient
                .sql("INSERT INTO posts (author, content, channel) VALUES (?, ?, ?)")
                .param(author)
                .param(content)
                .param(channel)
                .update();
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

    private TimelinePost mapTimelinePost(ResultSet rs, int rowNum) throws SQLException {
        TimelineEntryKind entryKind = entryKind(rs.getInt("entry_kind"));
        PostCursor cursor = new PostCursor(
                parseInstant(rs.getString("activity_at")),
                entryKind,
                rs.getLong("entry_id"));
        return new TimelinePost(mapPost(rs, rowNum), cursor);
    }

    private TimelineEntryKind entryKind(int sortOrder) throws SQLException {
        for (TimelineEntryKind entryKind : TimelineEntryKind.values()) {
            if (entryKind.sortOrder() == sortOrder) {
                return entryKind;
            }
        }
        throw new SQLException("Unknown timeline entry kind order: " + sortOrder);
    }

    private Instant parseInstant(String value) {
        return LocalDateTime.parse(value, SQLITE_DATETIME).toInstant(ZoneOffset.UTC);
    }
}
