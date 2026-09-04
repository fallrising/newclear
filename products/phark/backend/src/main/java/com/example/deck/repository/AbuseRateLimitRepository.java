package com.example.deck.repository;

import java.util.OptionalInt;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class AbuseRateLimitRepository {
    private static final Pattern HMAC = Pattern.compile("[0-9a-f]{64}");
    private final JdbcClient jdbcClient;

    public AbuseRateLimitRepository(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public OptionalInt reserve(String scope, String subjectKind, String subjectHmac,
            long windowStart, long windowEnd, long limit) {
        if (scope == null || subjectKind == null || subjectHmac == null
                || !HMAC.matcher(subjectHmac).matches() || limit <= 0
                || windowEnd <= windowStart) {
            throw new IllegalArgumentException("Invalid rate-limit reservation");
        }
        Integer count = jdbcClient.sql("""
                INSERT INTO abuse_rate_limit_buckets
                    (scope, subject_kind, subject_hmac, window_start_epoch, window_end_epoch,
                     expires_at_epoch, request_count)
                VALUES (:scope, :subjectKind, :subjectHmac, :windowStart, :windowEnd,
                        :expiresAt, 1)
                ON CONFLICT (scope, subject_kind, subject_hmac, window_start_epoch)
                DO UPDATE SET request_count = request_count + 1
                WHERE request_count < :limit
                RETURNING request_count""")
                .param("scope", scope)
                .param("subjectKind", subjectKind)
                .param("subjectHmac", subjectHmac)
                .param("windowStart", windowStart)
                .param("windowEnd", windowEnd)
                .param("expiresAt", windowEnd + 86400)
                .param("limit", limit)
                .query(Integer.class)
                .optional()
                .orElse(null);
        return count == null ? OptionalInt.empty() : OptionalInt.of(count);
    }

    public int deleteExpired(long currentEpochSecond) {
        return jdbcClient.sql("DELETE FROM abuse_rate_limit_buckets WHERE expires_at_epoch <= :now")
                .param("now", currentEpochSecond).update();
    }
}
