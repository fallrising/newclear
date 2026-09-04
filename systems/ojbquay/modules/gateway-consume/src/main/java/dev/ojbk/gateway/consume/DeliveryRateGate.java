package dev.ojbk.gateway.consume;

@FunctionalInterface
public interface DeliveryRateGate {
    boolean awaitPermit();
}
