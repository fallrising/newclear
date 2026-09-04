package com.example.deck.model;

import java.util.List;

public record PostPage(List<Post> items, String nextCursor) {}
