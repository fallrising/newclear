package com.example.deck.service;

import com.example.deck.model.RateLimitResult;
import com.example.deck.model.RateLimitScope;
import com.example.deck.repository.AbuseRateLimitRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AbuseRateLimitService {
    private static final Pattern IP_HMAC = Pattern.compile("[0-9a-f]{64}");
    private final AbuseRateLimitRepository repository;
    private final ClientSignalHasher hasher;
    private final Clock clock;

    @Autowired
    public AbuseRateLimitService(AbuseRateLimitRepository repository, ClientSignalHasher hasher) {
        this(repository, hasher, Clock.systemUTC());
    }

    AbuseRateLimitService(AbuseRateLimitRepository repository, ClientSignalHasher hasher, Clock clock) {
        this.repository = repository;
        this.hasher = hasher;
        this.clock = clock;
    }

    @Transactional
    public RateLimitResult reserve(RateLimitScope scope, Long accountId, String ipHmac) {
        if (scope == null || ipHmac == null || !IP_HMAC.matcher(ipHmac).matches()) {
            throw new IllegalArgumentException("Invalid rate limit request");
        }
        if (scope.authenticated() && (accountId == null || accountId <= 0)) {
            throw new IllegalArgumentException("Account id required");
        }
        if (!scope.authenticated() && accountId != null) {
            throw new IllegalArgumentException("Anonymous scope cannot use account id");
        }
        long now = Instant.now(clock).getEpochSecond();
        long start = Math.floorDiv(now, scope.windowSeconds()) * scope.windowSeconds();
        long end = start + scope.windowSeconds();
        List<Policy> policies = new ArrayList<>();
        if (scope.authenticated()) {
            policies.add(
                    new Policy("ACCOUNT", hasher.hashAccount(accountId), scope.accountLimit(), 0));
        }
        policies.add(new Policy("IP", ipHmac, scope.ipLimit(), 1));
        List<PolicyState> states = new ArrayList<>();
        long resetSeconds = Math.max(1, end - now);
        for (Policy policy : policies) {
            int count = repository.reserve(
                            scope.name(),
                            policy.kind(),
                            policy.hmac(),
                            start,
                            end,
                            policy.limit())
                    .orElseThrow(() -> denied(policy.limit(), resetSeconds));
            states.add(new PolicyState(policy, count, resetSeconds));
        }
        PolicyState binding = states.stream().min(this::compareBinding).orElseThrow();
        return new RateLimitResult(
                binding.policy().limit(), binding.remaining(), binding.resetSeconds());
    }

    private int compareBinding(PolicyState left, PolicyState right) {
        int ratio = Long.compare(
                (long) left.remaining() * right.policy().limit(),
                (long) right.remaining() * left.policy().limit());
        if (ratio != 0) {
            return ratio;
        }
        int reset = Long.compare(left.resetSeconds(), right.resetSeconds());
        return reset != 0
                ? reset
                : Integer.compare(left.policy().stableOrder(), right.policy().stableOrder());
    }

    private RateLimitExceededException denied(int limit, long resetSeconds) {
        return new RateLimitExceededException(limit, resetSeconds);
    }

    private record Policy(String kind, String hmac, int limit, int stableOrder) {}

    private record PolicyState(Policy policy, int count, long resetSeconds) {
        int remaining() {
            return Math.max(0, policy.limit() - count);
        }
    }
}
