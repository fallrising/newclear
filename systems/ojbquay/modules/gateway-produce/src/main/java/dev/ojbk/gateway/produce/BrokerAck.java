package dev.ojbk.gateway.produce;

public record BrokerAck(String topic, int partition, long offset) {}
