package com.example.deck.repository;

import com.example.deck.model.RepostState;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class PostRepostRepository {

    private final JdbcClient jdbcClient;

    public PostRepostRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public boolean repost(long postId, long accountId) {
        int created = jdbcClient
                .sql("""
                        INSERT INTO post_reposts (post_id, account_id)
                        VALUES (:postId, :accountId)
                        ON CONFLICT (post_id, account_id) DO NOTHING""")
                .param("postId", postId)
                .param("accountId", accountId)
                .update();
        return created > 0;
    }

    public void unrepost(long postId, long accountId) {
        jdbcClient
                .sql("""
                        DELETE FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .update();
    }

    public RepostState getState(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT :postId AS post_id,
                               (SELECT COUNT(*)
                                FROM post_reposts
                                WHERE post_id = :postId) AS repost_count,
                               EXISTS(
                                   SELECT 1
                                   FROM post_reposts
                                   WHERE post_id = :postId AND account_id = :accountId
                               ) AS reposted_by_viewer""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query((rs, rowNum) -> new RepostState(
                        rs.getLong("post_id"),
                        rs.getLong("repost_count"),
                        rs.getBoolean("reposted_by_viewer")))
                .single();
    }
}
