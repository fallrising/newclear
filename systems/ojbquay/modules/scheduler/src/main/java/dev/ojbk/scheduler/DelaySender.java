package dev.ojbk.scheduler;

@FunctionalInterface
public interface DelaySender {
    void send(DelayDelivery delivery);
}
