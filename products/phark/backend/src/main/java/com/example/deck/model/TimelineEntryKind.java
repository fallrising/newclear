package com.example.deck.model;

public enum TimelineEntryKind {
    POST("POST", 1),
    REPOST("REPOST", 0);

    private final String canonical;
    private final int sortOrder;

    TimelineEntryKind(String canonical, int sortOrder) {
        this.canonical = canonical;
        this.sortOrder = sortOrder;
    }

    public String canonical() {
        return canonical;
    }

    public int sortOrder() {
        return sortOrder;
    }
}
