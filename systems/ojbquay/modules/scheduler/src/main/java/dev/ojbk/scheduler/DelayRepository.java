package dev.ojbk.scheduler;

import dev.ojbk.delay.DelayCommand;
import java.time.Instant;
import java.util.List;

public interface DelayRepository {
    void applyBatch(List<DelayCommand> commands);

    int dispatchDue(Instant now, int limit, DelaySender sender);

    int cleanupTerminal(Instant before, int limit);

    long pendingCount();
}
