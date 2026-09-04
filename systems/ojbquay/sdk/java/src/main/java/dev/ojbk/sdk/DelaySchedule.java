package dev.ojbk.sdk;

import java.time.Duration;
import java.time.Instant;

public record DelaySchedule(
        String delayId,
        Instant dueAt,
        Duration loopInterval,
        Integer loopTimes,
        Instant expireAt) {

    public DelaySchedule {
        if (dueAt == null) {
            throw new IllegalArgumentException("dueAt must not be null");
        }
        delayId = delayId == null ? "" : delayId;
        if ((loopInterval == null) != (loopTimes == null)) {
            throw new IllegalArgumentException(
                    "loopInterval and loopTimes must be supplied together");
        }
        if (loopInterval != null && (loopInterval.isZero() || loopInterval.isNegative())) {
            throw new IllegalArgumentException("loopInterval must be positive");
        }
        if (loopInterval != null && loopInterval.compareTo(Duration.ofDays(30)) > 0) {
            throw new IllegalArgumentException("loopInterval exceeds the 30 day limit");
        }
        if (loopTimes != null && (loopTimes < 2 || loopTimes > 10_000)) {
            throw new IllegalArgumentException("loopTimes must be 2..10000");
        }
        if (expireAt != null && !expireAt.isAfter(dueAt)) {
            throw new IllegalArgumentException("expireAt must be after dueAt");
        }
    }

    public static DelaySchedule once(Instant dueAt) {
        return new DelaySchedule("", dueAt, null, null, null);
    }
}
