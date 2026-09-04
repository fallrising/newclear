package dev.ojbk.gateway.consume;

import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Duration;
import java.util.Objects;
import java.util.OptionalLong;

public final class OrderedPushRecordHandler {
    private final PushPipeline pipeline;
    private final PushHttpClient http;
    private final RetryPublisher retries;
    private final DeliveryRateGate rateGate;
    private final Sleeper sleeper;
    private final ConsumeMetrics metrics;

    public OrderedPushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            DeliveryRateGate rateGate) {
        this(pipeline, http, retries, rateGate, Thread::sleep, null);
    }

    public OrderedPushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            DeliveryRateGate rateGate,
            ConsumeMetrics metrics) {
        this(pipeline, http, retries, rateGate, Thread::sleep, metrics);
    }

    OrderedPushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            DeliveryRateGate rateGate,
            Sleeper sleeper) {
        this(pipeline, http, retries, rateGate, sleeper, null);
    }

    OrderedPushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            DeliveryRateGate rateGate,
            Sleeper sleeper,
            ConsumeMetrics metrics) {
        this.pipeline = Objects.requireNonNull(pipeline, "pipeline");
        this.http = Objects.requireNonNull(http, "http");
        this.retries = Objects.requireNonNull(retries, "retries");
        this.rateGate = Objects.requireNonNull(rateGate, "rateGate");
        this.sleeper = Objects.requireNonNull(sleeper, "sleeper");
        this.metrics = metrics;
    }

    public boolean handle(PushMessage message, SubscriptionConfig subscription) {
        long startedNanos = System.nanoTime();
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(subscription.spec());
        PipelineResult result = pipeline.apply(message, spec);
        if (result.action() == PipelineAction.FILTERED) {
            return outcome(subscription, "filtered", startedNanos, true);
        }
        if (result.action() == PipelineAction.ERROR) {
            return terminal(
                    message, subscription, spec, "PIPELINE_ERROR", startedNanos);
        }

        int retryIndex = 0;
        while (!Thread.currentThread().isInterrupted()) {
            if (!rateGate.awaitPermit()) {
                return outcome(subscription, "released", startedNanos, false);
            }
            PushHttpResult delivered;
            try {
                delivered = http.deliver(PushRequests.from(result, spec));
            } catch (RuntimeException transport) {
                delivered = PushHttpResult.transportFailure(1);
            }
            if (delivered.success()) {
                return outcome(subscription, "success", startedNanos, true);
            }
            OptionalLong delay = spec.retryDelayMs(retryIndex++);
            if (delay.isEmpty()) {
                return terminal(
                        message, subscription, spec, "RETRY_EXHAUSTED", startedNanos);
            }
            if (metrics != null) {
                metrics.recordRetry(subscription.id(), retryIndex);
            }
            try {
                sleeper.sleep(Duration.ofMillis(delay.getAsLong()));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return outcome(subscription, "released", startedNanos, false);
            }
        }
        return outcome(subscription, "released", startedNanos, false);
    }

    public boolean invalidOrderKey(
            PushMessage message, SubscriptionConfig subscription) {
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(subscription.spec());
        return terminal(
                message,
                subscription,
                spec,
                "ORDER_KEY_ERROR",
                System.nanoTime());
    }

    private boolean terminal(
            PushMessage message,
            SubscriptionConfig subscription,
            PushSubscriptionSpec spec,
            String reason,
            long startedNanos) {
        if (!spec.dlqEnabled()) {
            return outcome(subscription, "blocked", startedNanos, false);
        }
        try {
            retries.publishDlq(
                    message,
                    message.originTopic() + "." + subscription.group() + ".dlq",
                    reason);
            if (metrics != null) {
                metrics.recordDlq(subscription.id());
            }
            return outcome(subscription, "dlq", startedNanos, true);
        } catch (RuntimeException unavailable) {
            return outcome(subscription, "released", startedNanos, false);
        }
    }

    private boolean outcome(
            SubscriptionConfig subscription,
            String code,
            long startedNanos,
            boolean terminal) {
        if (metrics != null) {
            metrics.recordPush(subscription.id(), code, startedNanos);
        }
        return terminal;
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration) throws InterruptedException;
    }
}
