package com.example.deck.repository;

import com.example.deck.model.LikeState;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class PostLikeRepository {

    private final JdbcClient jdbcClient;

    public PostLikeRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public boolean like(long postId, long accountId) {
        int created = jdbcClient
                .sql("""
                        INSERT INTO post_likes (post_id, account_id)
                        VALUES (:postId, :accountId)
                        ON CONFLICT (post_id, account_id) DO NOTHING""")
                .param("postId", postId)
                .param("accountId", accountId)
                .update();
        return created > 0;
    }

    public void unlike(long postId, long accountId) {
        jdbcClient
                .sql("""
                        DELETE FROM post_likes
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .update();
    }

    public LikeState getState(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT :postId AS post_id,
                               (SELECT COUNT(*)
                                FROM post_likes
                                WHERE post_id = :postId) AS like_count,
                               EXISTS(
                                   SELECT 1
                                   FROM post_likes
                                   WHERE post_id = :postId AND account_id = :accountId
                               ) AS liked_by_viewer""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query((rs, rowNum) -> new LikeState(
                        rs.getLong("post_id"),
                        rs.getLong("like_count"),
                        rs.getBoolean("liked_by_viewer")))
                .single();
    }
}
