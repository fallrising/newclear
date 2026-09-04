package dev.ojbk.gateway.consume;

import dev.ojbk.config.SubscriptionConfig;

@FunctionalInterface
interface PullWorkerFactory {
    PullWorker create(SubscriptionConfig subscription);
}
