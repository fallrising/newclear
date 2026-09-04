package com.example.deck.web;

import com.example.deck.model.RateLimitResult;
import com.example.deck.service.RateLimitExceededException;
import jakarta.servlet.http.HttpServletResponse;

public final class RateLimitHeaders {

    public static final String LIMIT = "RateLimit-Limit";
    public static final String REMAINING = "RateLimit-Remaining";
    public static final String RESET = "RateLimit-Reset";

    private RateLimitHeaders() {}

    public static void write(HttpServletResponse response, RateLimitResult result) {
        write(response, result.limit(), result.remaining(), result.resetSeconds());
    }

    public static void write(HttpServletResponse response, RateLimitExceededException exception) {
        write(response, exception.limit(), exception.remaining(), exception.resetSeconds());
        response.setHeader("Retry-After", Long.toString(exception.resetSeconds()));
    }

    private static void write(HttpServletResponse response, long limit, long remaining, long reset) {
        response.setHeader(LIMIT, Long.toString(limit));
        response.setHeader(REMAINING, Long.toString(remaining));
        response.setHeader(RESET, Long.toString(reset));
        response.setHeader("Cache-Control", "private, no-store");
    }
}
