package com.example.deck.service;

public class RateLimitExceededException extends RuntimeException {
    private final long limit;
    private final long resetSeconds;

    public RateLimitExceededException(long limit, long resetSeconds) {
        super("Rate limit exceeded");
        if (limit <= 0 || resetSeconds <= 0) {
            throw new IllegalArgumentException("Public rate-limit values must be positive");
        }
        this.limit = limit;
        this.resetSeconds = resetSeconds;
    }

    public long limit() {
        return limit;
    }

    public long remaining() {
        return 0;
    }

    public long resetSeconds() {
        return resetSeconds;
    }
}
