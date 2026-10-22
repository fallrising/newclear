package dev.ojbk.scheduler;

import dev.ojbk.delay.DelayCommand;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Optional;

public interface DelayRepository {
    void applyBatch(List<DelayCommand> commands);

    int dispatchDue(Instant now, int limit, DelaySender sender);

    int cleanupTerminal(Instant before, int limit);

    long pendingCount();

    Optional<Instant> nextDueAt();

    /** Wait for a snapshot-invalidating hint or the bounded scan deadline. */
    default boolean awaitChange(Duration timeout) throws InterruptedException {
        Thread.sleep(timeout);
        return false;
    }
}
