package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

final class FixedRateGateTest {
    @Test
    void spacesConcurrentDeliveryStartsAtTheConfiguredRate() {
        AtomicLong now = new AtomicLong();
        List<Long> waits = new ArrayList<>();
        FixedRateGate gate = new FixedRateGate(
                100,
                now::get,
                nanos -> {
                    waits.add(nanos);
                    now.addAndGet(nanos);
                });

        assertThat(gate.awaitPermit()).isTrue();
        assertThat(gate.awaitPermit()).isTrue();
        assertThat(gate.awaitPermit()).isTrue();

        assertThat(waits).containsExactly(10_000_000L, 10_000_000L);
    }

    @Test
    void reportsInterruptedWaitWithoutConsumingHttpWork() {
        FixedRateGate gate = new FixedRateGate(
                1,
                () -> 0,
                nanos -> {
                    throw new InterruptedException("stop");
                });

        assertThat(gate.awaitPermit()).isTrue();
        assertThat(gate.awaitPermit()).isFalse();
        assertThat(Thread.interrupted()).isTrue();
    }
}
