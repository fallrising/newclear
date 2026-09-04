package dev.ojbk.gateway.consume;

import dev.ojbk.config.SubscriptionConfig;

@FunctionalInterface
public interface PushWorkerFactory {
    PushSubscriptionWorker create(SubscriptionConfig subscription);
}
