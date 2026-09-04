package dev.ojbk.sdk;

import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class ConsumerSubscription implements AutoCloseable {
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final AtomicReference<Throwable> lastError = new AtomicReference<>();
    private volatile Thread thread;

    ConsumerSubscription() {}

    void attach(Thread value) {
        thread = java.util.Objects.requireNonNull(value, "thread");
        if (!running.get()) {
            value.interrupt();
        }
    }

    boolean runningFlag() {
        return running.get();
    }

    void failed(Throwable failure) {
        lastError.set(failure);
    }

    void finished() {
        running.set(false);
    }

    public boolean running() {
        return running.get();
    }

    public Optional<Throwable> lastError() {
        return Optional.ofNullable(lastError.get());
    }

    @Override
    public void close() {
        if (!running.compareAndSet(true, false)) {
            return;
        }
        Thread active = thread;
        if (active != null) {
            active.interrupt();
            if (active != Thread.currentThread()) {
                try {
                    active.join(Duration.ofSeconds(5));
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }
}
