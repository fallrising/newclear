package dev.ojbk.gateway.consume;

import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.LockSupport;
import java.util.function.LongSupplier;

public final class FixedRateGate implements DeliveryRateGate {
    private static final long NANOS_PER_SECOND = 1_000_000_000L;

    private final long intervalNanos;
    private final AtomicLong nextPermitNanos = new AtomicLong(Long.MIN_VALUE);
    private final LongSupplier nanoTime;
    private final Sleeper sleeper;

    public FixedRateGate(int maxTps) {
        this(maxTps, System::nanoTime, FixedRateGate::park);
    }

    FixedRateGate(int maxTps, LongSupplier nanoTime, Sleeper sleeper) {
        if (maxTps < 1 || maxTps > 1_000_000) {
            throw new IllegalArgumentException("maxTps must be 1..1000000");
        }
        intervalNanos = (NANOS_PER_SECOND + maxTps - 1) / maxTps;
        this.nanoTime = java.util.Objects.requireNonNull(nanoTime, "nanoTime");
        this.sleeper = java.util.Objects.requireNonNull(sleeper, "sleeper");
    }

    @Override
    public boolean awaitPermit() {
        long now = nanoTime.getAsLong();
        long permitAt;
        while (true) {
            long observed = nextPermitNanos.get();
            permitAt = observed == Long.MIN_VALUE ? now : Math.max(now, observed);
            long next = permitAt > Long.MAX_VALUE - intervalNanos
                    ? Long.MAX_VALUE
                    : permitAt + intervalNanos;
            if (nextPermitNanos.compareAndSet(observed, next)) {
                break;
            }
        }
        long waitNanos = permitAt - now;
        if (waitNanos <= 0) {
            return true;
        }
        try {
            sleeper.sleep(waitNanos);
            return true;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static void park(long nanos) throws InterruptedException {
        long deadline = System.nanoTime() + nanos;
        long remaining = nanos;
        while (remaining > 0) {
            LockSupport.parkNanos(remaining);
            if (Thread.interrupted()) {
                throw new InterruptedException("rate wait interrupted");
            }
            remaining = deadline - System.nanoTime();
        }
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(long nanos) throws InterruptedException;
    }
}
