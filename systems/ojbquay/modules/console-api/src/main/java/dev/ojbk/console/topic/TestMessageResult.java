package dev.ojbk.console.topic;

public record TestMessageResult(String topic, int partition, long offset) {}
