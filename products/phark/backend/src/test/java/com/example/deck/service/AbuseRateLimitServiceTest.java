package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.RateLimitResult;
import com.example.deck.model.RateLimitScope;
import com.example.deck.repository.AbuseRateLimitRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class AbuseRateLimitServiceTest {
    @Autowired
    private AbuseRateLimitRepository repository;

    @Autowired
    private ClientSignalHasher hasher;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @BeforeEach
    void cleanBuckets() {
        jdbc.sql("DELETE FROM abuse_rate_limit_buckets").update();
    }

    @Test
    void exactPoliciesAndPublicScopeApiAreExplicit() {
        assertThat(RateLimitScope.REGISTER.authenticated()).isFalse();
        assertThat(RateLimitScope.REGISTER.windowSeconds()).isEqualTo(3600);
        assertThat(RateLimitScope.REGISTER.ipLimit()).isEqualTo(5);
        assertThat(RateLimitScope.LOGIN.authenticated()).isFalse();
        assertThat(RateLimitScope.LOGIN.windowSeconds()).isEqualTo(900);
        assertThat(RateLimitScope.LOGIN.ipLimit()).isEqualTo(10);
        assertThat(RateLimitScope.CONTENT_WRITE.accountLimit()).isEqualTo(20);
        assertThat(RateLimitScope.CONTENT_WRITE.authenticated()).isTrue();
        assertThat(RateLimitScope.CONTENT_WRITE.ipLimit()).isEqualTo(60);
        assertThat(RateLimitScope.CONTENT_WRITE.windowSeconds()).isEqualTo(60);
        assertThat(RateLimitScope.SOCIAL_WRITE.accountLimit()).isEqualTo(120);
        assertThat(RateLimitScope.SOCIAL_WRITE.ipLimit()).isEqualTo(240);
        assertThat(RateLimitScope.SOCIAL_WRITE.windowSeconds()).isEqualTo(60);
        assertThat(RateLimitScope.REPORT_WRITE.accountLimit()).isEqualTo(10);
        assertThat(RateLimitScope.REPORT_WRITE.ipLimit()).isEqualTo(20);
        assertThat(RateLimitScope.REPORT_WRITE.windowSeconds()).isEqualTo(3600);
        assertThatThrownBy(() -> RateLimitScope.REGISTER.accountLimit())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> RateLimitScope.LOGIN.accountLimit())
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void validatesHmacAndAccountPresence() {
        AbuseRateLimitService service = serviceAt(60);
        assertThatThrownBy(() -> service.reserve(RateLimitScope.REGISTER, 1L, validHmac()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.reserve(RateLimitScope.CONTENT_WRITE, null, validHmac()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.reserve(RateLimitScope.CONTENT_WRITE, 0L, validHmac()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.reserve(RateLimitScope.REGISTER, null, "A".repeat(64)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void exceptionAlwaysExposesZeroRemaining() {
        RateLimitExceededException exception = new RateLimitExceededException(5, 12);
        assertThat(exception.limit()).isEqualTo(5);
        assertThat(exception.remaining()).isZero();
        assertThat(exception.resetSeconds()).isEqualTo(12);
        assertThatThrownBy(() -> new RateLimitExceededException(0, 12))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void anonymousAndAuthenticatedPoliciesUseExactLimitsAndAlignedReset() {
        AbuseRateLimitService service = serviceAt(3601);
        String ip = hasher.hashIp("192.0.2.1");
        assertThat(service.reserve(RateLimitScope.REGISTER, null, ip))
                .isEqualTo(new com.example.deck.model.RateLimitResult(5, 4, 3599));
        assertThatThrownBy(() -> service.reserve(RateLimitScope.CONTENT_WRITE, null, ip))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(service.reserve(RateLimitScope.CONTENT_WRITE, 7L, ip).limit())
                .isEqualTo(20);
    }

    @Test
    void accountDenialRollsBackIpReservation() {
        AbuseRateLimitService service = serviceAt(60);
        String ip = hasher.hashIp("192.0.2.2");
        for (int index = 0; index < 20; index++) {
            service.reserve(RateLimitScope.CONTENT_WRITE, 9L, ip);
        }
        assertThatThrownBy(() -> service.reserve(RateLimitScope.CONTENT_WRITE, 9L, ip))
                .isInstanceOf(RateLimitExceededException.class)
                .satisfies(exception -> {
                    RateLimitExceededException exceeded =
                            (RateLimitExceededException) exception;
                    assertThat(exceeded.limit()).isEqualTo(20);
                    assertThat(exceeded.remaining()).isZero();
                    assertThat(exceeded.resetSeconds()).isEqualTo(60);
                });
        long ipCount = repositoryCount("IP");
        assertThat(ipCount).isEqualTo(20);
    }

    @Test
    void accountFirstDenialDoesNotIncrementIpForNewAddress() {
        AbuseRateLimitService service = serviceAt(60);
        String firstIp = validHmac();
        for (int i = 0; i < RateLimitScope.CONTENT_WRITE.accountLimit(); i++) {
            service.reserve(RateLimitScope.CONTENT_WRITE, 55L, firstIp);
        }
        String secondIp = "b".repeat(64);
        assertThatThrownBy(() -> service.reserve(RateLimitScope.CONTENT_WRITE, 55L, secondIp))
                .isInstanceOf(RateLimitExceededException.class);
        assertThat(jdbc.sql(
                                "SELECT COUNT(*) FROM abuse_rate_limit_buckets WHERE subject_hmac = :hmac")
                        .param("hmac", secondIp)
                        .query(Long.class)
                        .single())
                .isZero();
    }

    @Test
    void ipDenialRollsBackAccountReservation() {
        AbuseRateLimitService service = serviceAt(60);
        String ip = validHmac();
        for (int i = 0; i < RateLimitScope.CONTENT_WRITE.ipLimit(); i++) {
            repository.reserve("CONTENT_WRITE", "IP", ip, 60, 120,
                    RateLimitScope.CONTENT_WRITE.ipLimit());
        }
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        assertThatThrownBy(() -> transaction.execute(status -> service.reserve(
                RateLimitScope.CONTENT_WRITE, 77L, ip)))
                .isInstanceOf(RateLimitExceededException.class)
                .satisfies(exception -> {
                    RateLimitExceededException exceeded =
                            (RateLimitExceededException) exception;
                    assertThat(exceeded.limit()).isEqualTo(60);
                    assertThat(exceeded.remaining()).isZero();
                    assertThat(exceeded.resetSeconds()).isEqualTo(60);
                });
        assertThat(accountCount()).isZero();
        assertThat(ipCount()).isEqualTo(RateLimitScope.CONTENT_WRITE.ipLimit());
    }

    @Test
    void allowedResultBindsToSmallestRemainingRatio() {
        AbuseRateLimitService service = serviceAt(60);
        String ip = validHmac();
        for (int i = 0; i < 10; i++) {
            repository.reserve("CONTENT_WRITE", "IP", ip, 60, 120, 60);
        }
        RateLimitResult result = service.reserve(RateLimitScope.CONTENT_WRITE, 88L, ip);
        assertThat(result.limit()).isEqualTo(60);
        assertThat(result.remaining()).isEqualTo(49);
        assertThat(result.resetSeconds()).isEqualTo(60);
    }

    @Test
    void tieBindsToAccountAndStateSurvivesNewInstances() {
        String ip = "c".repeat(64);
        for (int i = 0; i < 4; i++) {
            repository.reserve("REPORT_WRITE", "ACCOUNT", hasher.hashAccount(99), 0, 3600, 10);
        }
        for (int i = 0; i < 9; i++) {
            repository.reserve("REPORT_WRITE", "IP", ip, 0, 3600, 20);
        }
        AbuseRateLimitService service = serviceAt(1);
        RateLimitResult result = service.reserve(RateLimitScope.REPORT_WRITE, 99L, ip);
        assertThat(result).isEqualTo(new RateLimitResult(10, 5, 3599));

        AbuseRateLimitRepository secondRepository = new AbuseRateLimitRepository(jdbc);
        AbuseRateLimitService secondService = new AbuseRateLimitService(
                secondRepository,
                hasher,
                Clock.fixed(Instant.ofEpochSecond(1), ZoneOffset.UTC));
        assertThat(secondService.reserve(RateLimitScope.REPORT_WRITE, 99L, ip))
                .isEqualTo(new RateLimitResult(10, 4, 3599));

        List<String> subjects = jdbc.sql(
                        "SELECT subject_hmac FROM abuse_rate_limit_buckets ORDER BY subject_kind")
                .query(String.class)
                .list();
        assertThat(subjects)
                .hasSize(2)
                .allMatch(value -> value.matches("[0-9a-f]{64}"))
                .doesNotContain("99");
    }

    @Test
    void serviceStoresOnlyHexSubjectsAndRecoversAtNextWindow() {
        AbuseRateLimitService service = serviceAt(3599);
        String ip = hasher.hashIp("203.0.113.9");
        assertThat(service.reserve(RateLimitScope.REGISTER, null, ip).resetSeconds())
                .isEqualTo(1);
        service = serviceAt(3600);
        assertThat(service.reserve(RateLimitScope.REGISTER, null, ip).remaining()).isEqualTo(4);
        assertThat(jdbc.sql("SELECT subject_hmac FROM abuse_rate_limit_buckets")
                        .query(String.class)
                        .list())
                .allMatch(value -> value.matches("[0-9a-f]{64}"))
                .noneMatch(value -> value.contains("203.0.113.9"));
    }

    private AbuseRateLimitService serviceAt(long epoch) {
        return new AbuseRateLimitService(
                repository,
                hasher,
                Clock.fixed(Instant.ofEpochSecond(epoch), ZoneOffset.UTC));
    }

    private long repositoryCount(String kind) {
        return jdbc.sql(
                        "SELECT request_count FROM abuse_rate_limit_buckets WHERE subject_kind = :kind")
                .param("kind", kind)
                .query(Long.class)
                .single();
    }

    private long accountCount() {
        return jdbc.sql("SELECT COALESCE(SUM(request_count), 0) FROM abuse_rate_limit_buckets "
                        + "WHERE subject_kind = 'ACCOUNT'")
                .query(Long.class).single();
    }

    private long ipCount() {
        return jdbc.sql("SELECT COALESCE(SUM(request_count), 0) FROM abuse_rate_limit_buckets "
                        + "WHERE subject_kind = 'IP'")
                .query(Long.class).single();
    }

    private String validHmac() {
        return "a".repeat(64);
    }
}
