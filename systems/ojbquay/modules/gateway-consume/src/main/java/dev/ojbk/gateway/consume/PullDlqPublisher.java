package dev.ojbk.gateway.consume;

@FunctionalInterface
interface PullDlqPublisher {
    void publish(PushMessage message, String topic, String reason);
}
