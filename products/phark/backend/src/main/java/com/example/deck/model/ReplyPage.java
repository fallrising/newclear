package com.example.deck.model;

import java.util.List;

public record ReplyPage(List<Reply> items, String nextCursor) {}
