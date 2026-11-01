package com.fallrising.cms.content.service;

import com.fallrising.cms.content.ContentException;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * At most LIMIT member create requests per principal in any WINDOW (02 §4.5: 5 per minute). A request counts when it
 * reaches the limiter, whether or not the entry is then created. Kept in memory per application instance.
 */
@Component
public class MeRateLimiter {

    public static final int LIMIT = 5;
    public static final Duration WINDOW = Duration.ofMinutes(1);

    private final Clock clock;
    private final Map<UUID, Deque<Instant>> calls = new ConcurrentHashMap<>();

    public MeRateLimiter() {
        this(Clock.systemUTC());
    }

    MeRateLimiter(Clock clock) {
        this.clock = clock;
    }

    /** Records one call, or throws 429 RATE_LIMITED when LIMIT calls happened in the last WINDOW. */
    public void acquire(UUID principalId) {
        Deque<Instant> recent = calls.computeIfAbsent(principalId, id -> new ArrayDeque<>());
        synchronized (recent) {
            Instant now = clock.instant();
            while (!recent.isEmpty() && !recent.peekFirst().isAfter(now.minus(WINDOW))) {
                recent.pollFirst();
            }
            if (recent.size() >= LIMIT) {
                throw ContentException.rateLimited();
            }
            recent.addLast(now);
        }
    }
}
