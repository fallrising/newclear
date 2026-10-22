package dev.ojbk.scheduler;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.delay.DelayCommand;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class DelayDispatcherTest {
    private static final Instant NOW = Instant.parse("2026-10-21T00:00:00Z");
    private static final Duration IDLE = Duration.ofMillis(100);

    @Test
    void wakesAtDurableDeadlineWithoutRoundingToIdleTick() {
        assertThat(waitFor(Optional.of(NOW.plusMillis(17)))).isEqualTo(Duration.ofMillis(17));
        assertThat(waitFor(Optional.of(NOW.plusSeconds(1)))).isEqualTo(IDLE);
        assertThat(waitFor(Optional.empty())).isEqualTo(IDLE);
    }

    @Test
    void overdueOrPeerLockedDeadlineCannotBusySpin() {
        assertThat(waitFor(Optional.of(NOW))).isEqualTo(Duration.ofMillis(1));
        assertThat(waitFor(Optional.of(NOW.minusSeconds(1)))).isEqualTo(Duration.ofMillis(1));
    }

    private static Duration waitFor(Optional<Instant> due) {
        DelayRepository repository = new DelayRepository() {
            @Override public Optional<Instant> nextDueAt() { return due; }
            @Override public void applyBatch(List<DelayCommand> commands) { throw new AssertionError(); }
            @Override public int dispatchDue(Instant now, int limit, DelaySender sender) { throw new AssertionError(); }
            @Override public int cleanupTerminal(Instant before, int limit) { throw new AssertionError(); }
            @Override public long pendingCount() { throw new AssertionError(); }
        };
        return new DelayDispatcher(repository, ignored -> {}).nextTickDelay(
                Clock.fixed(NOW, ZoneOffset.UTC), IDLE);
    }
}
