package dev.ojbk.sdk;

public record ProduceAcknowledgement(String topic, int partition, long offset) {}
