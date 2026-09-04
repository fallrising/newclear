package dev.ojbk.gateway.consume;

import java.time.Duration;
import java.util.List;
import java.util.Map;

interface PullBroker extends AutoCloseable {
    List<PullBrokerRecord> poll(Duration timeout);

    void settle(Map<PullRecordId, PullDisposition> dispositions);

    void wakeup();

    @Override
    void close();
}
