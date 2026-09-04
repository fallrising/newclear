package dev.ojbk.gateway.consume;

import java.time.Duration;
import java.util.List;

interface PullGateway {
    PullPollResult poll(
            String group, String topic, int maxBatch, Duration linger);

    PullAckResult acknowledge(
            String group,
            List<String> accepted,
            List<String> released,
            Duration timeout);
}
