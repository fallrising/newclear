package com.example.deck.model;

public record RateLimitResult(long limit, long remaining, long resetSeconds) {}
