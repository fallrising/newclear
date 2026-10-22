package dev.ojbk.gateway.consume;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;

public final class BoundedStripedExecutor implements AutoCloseable {
    private final ExecutorService[] stripes;
    private final Semaphore capacity;

    public BoundedStripedExecutor(int stripeCount, int maxInFlight) {
        if (stripeCount < 1 || stripeCount > 500) {
            throw new IllegalArgumentException("stripeCount must be 1..500");
        }
        if (maxInFlight < stripeCount || maxInFlight > 500) {
            throw new IllegalArgumentException(
                    "maxInFlight must be stripeCount..500");
        }
        capacity = new Semaphore(maxInFlight);
        stripes = new ExecutorService[stripeCount];
        for (int index = 0; index < stripeCount; index++) {
            stripes[index] = Executors.newSingleThreadExecutor(
                    Thread.ofVirtual()
                            .name("ojbquay-order-stripe-" + index + "-", 0)
                            .factory());
        }
    }

    public <T> Future<T> submit(String key, Callable<T> task)
            throws InterruptedException {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("order key must not be blank");
        }
        java.util.Objects.requireNonNull(task, "task");
        capacity.acquire();
        try {
            return stripes[Math.floorMod(key.hashCode(), stripes.length)]
                    .submit(() -> {
                        try {
                            return task.call();
                        } finally {
                            capacity.release();
                        }
                    });
        } catch (RejectedExecutionException rejected) {
            capacity.release();
            throw rejected;
        }
    }

    @Override
    public void close() {
        for (ExecutorService stripe : stripes) {
            for (Runnable queued : stripe.shutdownNow()) {
                if (queued instanceof Future<?> future) {
                    future.cancel(true);
                }
            }
        }
        long deadline = System.nanoTime() + java.time.Duration.ofSeconds(5).toNanos();
        for (ExecutorService stripe : stripes) {
            try {
                if (!stripe.awaitTermination(Math.max(0, deadline - System.nanoTime()),
                        java.util.concurrent.TimeUnit.NANOSECONDS)) {
                    throw new IllegalStateException("ordered handlers have not terminated");
                }
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("ordered handler stop interrupted", interrupted);
            }
        }
    }
}
