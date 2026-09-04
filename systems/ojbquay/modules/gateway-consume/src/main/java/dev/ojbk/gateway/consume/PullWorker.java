package dev.ojbk.gateway.consume;

import java.time.Duration;
import java.util.List;

interface PullWorker extends PushSubscriptionWorker {
    long subscriptionId();

    String group();

    String topic();

    List<PullDelivery> pollBatch(int maximum, Duration linger)
            throws InterruptedException;

    PullAckResult acknowledge(
            List<String> accepted, List<String> released, Duration timeout);
}
