package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.OptionalInt;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
class AbuseRateLimitRepositoryTest {
    @Autowired
    private AbuseRateLimitRepository repository;

    @Autowired
    private JdbcClient jdbc;

    @BeforeEach
    void cleanBuckets() {
        jdbc.sql("DELETE FROM abuse_rate_limit_buckets").update();
    }

    @Test
    void rejectsNonPositiveLimitBeforeWriting() {
        assertThatThrownBy(() -> reserve(0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(count()).isZero();
    }

    @Test
    void conditionalUpsertAcceptsLimitAndDoesNotPersistNextRequest() {
        OptionalInt first = reserve(5);
        OptionalInt second = reserve(5);
        assertThat(first).hasValue(1);
        assertThat(second).hasValue(2);
        for (int index = 0; index < 3; index++) {
            assertThat(reserve(5)).hasValue(3 + index);
        }
        assertThat(reserve(5)).isEmpty();
        assertThat(requestCount()).isEqualTo(5);
    }

    @Test
    void expiredCleanupLeavesLiveBucket() {
        repository.reserve("REGISTER", "IP", "a".repeat(64), 0, 3600, 5);
        repository.reserve("REGISTER", "IP", "b".repeat(64), 3600, 7200, 5);
        assertThat(repository.deleteExpired(90000)).isEqualTo(1);
        assertThat(count()).isEqualTo(1);
    }

    @Test
    void concurrentReservationsNeverExceedLimit() throws Exception {
        var executor = Executors.newFixedThreadPool(8);
        try {
            List<Callable<OptionalInt>> tasks = java.util.stream.IntStream.range(0, 20)
                    .mapToObj(index -> (Callable<OptionalInt>) () -> reserve(5))
                    .toList();
            long accepted = executor.invokeAll(tasks).stream()
                    .filter(future -> {
                        try {
                            return future.get().isPresent();
                        } catch (Exception exception) {
                            throw new RuntimeException(exception);
                        }
                    })
                    .count();
            assertThat(accepted).isEqualTo(5);
            assertThat(requestCount()).isEqualTo(5);
        } finally {
            executor.shutdownNow();
        }
    }

    private OptionalInt reserve(long limit) {
        return repository.reserve("REGISTER", "IP", "a".repeat(64), 0, 3600, limit);
    }

    private long count() {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_rate_limit_buckets")
                .query(Long.class)
                .single();
    }

    private long requestCount() {
        return jdbc.sql(
                        "SELECT request_count FROM abuse_rate_limit_buckets WHERE subject_hmac = :hmac")
                .param("hmac", "a".repeat(64))
                .query(Long.class)
                .single();
    }
}
