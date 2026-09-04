package com.example.deck.model;

public enum RateLimitScope {
    REGISTER(3600, 0, 5),
    LOGIN(900, 0, 10),
    CONTENT_WRITE(60, 20, 60),
    SOCIAL_WRITE(60, 120, 240),
    REPORT_WRITE(3600, 10, 20);

    private final long windowSeconds;
    private final int accountLimit;
    private final int ipLimit;

    RateLimitScope(long windowSeconds, int accountLimit, int ipLimit) {
        this.windowSeconds = windowSeconds;
        this.accountLimit = accountLimit;
        this.ipLimit = ipLimit;
    }

    public int accountLimit() {
        if (!authenticated()) {
            throw new IllegalStateException("Scope has no account policy");
        }
        return accountLimit;
    }

    public int ipLimit() {
        return ipLimit;
    }

    public long windowSeconds() {
        return windowSeconds;
    }

    public boolean authenticated() {
        return accountLimit > 0;
    }
}
