package com.fallrising.cms.content.service;

import com.fallrising.cms.content.ContentException;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class MeRateLimiterTests {
    private static final Instant START = Instant.parse("2026-01-01T00:00:00Z");

    private static final class MovingClock extends Clock {
        volatile Instant now = START;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @Test
    void fifthCallPassesAndTheExactSixtySecondBoundaryExpiresCalls() {
        MovingClock clock = new MovingClock();
        MeRateLimiter limiter = new MeRateLimiter(clock);
        UUID principal = UUID.randomUUID();
        for (int i = 0; i < 5; i++) limiter.acquire(principal);
        assertRateLimited(limiter, principal);
        clock.now = START.plus(Duration.ofSeconds(60)).minusNanos(1);
        assertRateLimited(limiter, principal);
        clock.now = START.plusSeconds(60);
        for (int i = 0; i < 5; i++) assertThatNoException().isThrownBy(() -> limiter.acquire(principal));
        assertRateLimited(limiter, principal);
    }

    @Test
    void rollingWindowExpiresIndividualCallsRatherThanResettingAWholeMinute() {
        MovingClock clock = new MovingClock();
        MeRateLimiter limiter = new MeRateLimiter(clock);
        UUID principal = UUID.randomUUID();
        for (int i = 0; i < 5; i++) {
            clock.now = START.plusSeconds(i * 10L);
            limiter.acquire(principal);
        }
        clock.now = START.plusSeconds(59);
        assertRateLimited(limiter, principal);
        clock.now = START.plusSeconds(60);
        limiter.acquire(principal);
        assertRateLimited(limiter, principal);
        clock.now = START.plusSeconds(70);
        limiter.acquire(principal);
        assertRateLimited(limiter, principal);
    }

    @Test
    void principalsHaveIndependentBudgetsAndDeniedCallsDoNotExtendTheWindow() {
        MovingClock clock = new MovingClock();
        MeRateLimiter limiter = new MeRateLimiter(clock);
        UUID first = UUID.randomUUID(), second = UUID.randomUUID();
        for (int i = 0; i < 5; i++) limiter.acquire(first);
        clock.now = START.plusSeconds(59);
        assertRateLimited(limiter, first);
        for (int i = 0; i < 5; i++) limiter.acquire(second);
        clock.now = START.plusSeconds(60);
        assertThatNoException().isThrownBy(() -> limiter.acquire(first));
        assertRateLimited(limiter, second);
    }

    @Test
    void concurrentCallsForOnePrincipalAdmitExactlyFive() throws Exception {
        MeRateLimiter limiter = new MeRateLimiter(Clock.fixed(START, ZoneOffset.UTC));
        UUID principal = UUID.randomUUID();
        CountDownLatch ready = new CountDownLatch(40), start = new CountDownLatch(1);
        try (var executor = Executors.newFixedThreadPool(40)) {
            var results = new ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int i = 0; i < 40; i++) {
                results.add(executor.submit(() -> {
                    ready.countDown();
                    if (!start.await(5, TimeUnit.SECONDS)) throw new AssertionError("Start gate timed out");
                    try {
                        limiter.acquire(principal);
                        return true;
                    } catch (ContentException failure) {
                        assertThat(failure.code().wire()).isEqualTo("RATE_LIMITED");
                        assertThat(failure.code().status().value()).isEqualTo(429);
                        return false;
                    }
                }));
            }
            try { assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue(); }
            finally { start.countDown(); }
            int admitted = 0;
            for (var result : results) if (result.get(5, TimeUnit.SECONDS)) admitted++;
            assertThat(admitted).isEqualTo(5);
        }
    }

    private static void assertRateLimited(MeRateLimiter limiter, UUID principal) {
        assertThatThrownBy(() -> limiter.acquire(principal)).isInstanceOfSatisfying(ContentException.class, failure -> {
            assertThat(failure.code().wire()).isEqualTo("RATE_LIMITED");
            assertThat(failure.code().status().value()).isEqualTo(429);
            assertThat(failure.getMessage()).isEqualTo("Too many requests; try again in a minute");
        });
    }
}
