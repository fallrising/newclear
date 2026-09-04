package dev.ojbk.gateway.consume;

import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.config.SubscriptionConfig;
import java.time.Clock;
import java.util.Objects;
import org.apache.kafka.clients.consumer.AcknowledgeType;

public final class PushRecordHandler {
    private final PushPipeline pipeline;
    private final PushHttpClient http;
    private final RetryPublisher retries;
    private final Clock clock;
    private final DeliveryRateGate rateGate;
    private final ConsumeMetrics metrics;

    public PushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            Clock clock) {
        this(pipeline, http, retries, clock, () -> true, null);
    }

    public PushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            Clock clock,
            DeliveryRateGate rateGate) {
        this(pipeline, http, retries, clock, rateGate, null);
    }

    public PushRecordHandler(
            PushPipeline pipeline,
            PushHttpClient http,
            RetryPublisher retries,
            Clock clock,
            DeliveryRateGate rateGate,
            ConsumeMetrics metrics) {
        this.pipeline = Objects.requireNonNull(pipeline, "pipeline");
        this.http = Objects.requireNonNull(http, "http");
        this.retries = Objects.requireNonNull(retries, "retries");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.rateGate = Objects.requireNonNull(rateGate, "rateGate");
        this.metrics = metrics;
    }

    public AcknowledgeType handle(
            PushMessage message, SubscriptionConfig subscription) {
        long startedNanos = System.nanoTime();
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(subscription.spec());
        PipelineResult result = pipeline.apply(message, spec);
        if (result.action() == PipelineAction.FILTERED) {
            return outcome(
                    subscription, "filtered", startedNanos, AcknowledgeType.ACCEPT);
        }
        if (result.action() == PipelineAction.ERROR) {
            return terminal(
                    message, subscription, spec, "PIPELINE_ERROR", startedNanos);
        }

        PushHttpResult delivered;
        if (!rateGate.awaitPermit()) {
            return outcome(
                    subscription, "released", startedNanos, AcknowledgeType.RELEASE);
        }
        try {
            delivered = http.deliver(PushRequests.from(result, spec));
        } catch (RuntimeException failure) {
            delivered = PushHttpResult.transportFailure(1);
        }
        if (delivered.success()) {
            return outcome(
                    subscription, "success", startedNanos, AcknowledgeType.ACCEPT);
        }

        int retryCount = message.retryCount();
        var delay = spec.retryDelayMs(retryCount);
        if (delay.isPresent()) {
            try {
                String retryTopic =
                        message.originTopic() + "." + subscription.group() + ".retry";
                int nextCount =
                        retryCount == Integer.MAX_VALUE ? retryCount : retryCount + 1;
                retries.schedule(
                        message,
                        retryTopic,
                        clock.instant().plusMillis(delay.getAsLong()),
                        nextCount);
                if (metrics != null) {
                    metrics.recordRetry(subscription.id(), nextCount);
                }
                return outcome(
                        subscription, "retry", startedNanos, AcknowledgeType.ACCEPT);
            } catch (RuntimeException unavailable) {
                return outcome(
                        subscription, "released", startedNanos, AcknowledgeType.RELEASE);
            }
        }
        return terminal(
                message, subscription, spec, "RETRY_EXHAUSTED", startedNanos);
    }

    private AcknowledgeType terminal(
            PushMessage message,
            SubscriptionConfig subscription,
            PushSubscriptionSpec spec,
            String reason,
            long startedNanos) {
        if (!spec.dlqEnabled()) {
            return outcome(
                    subscription, "rejected", startedNanos, AcknowledgeType.REJECT);
        }
        try {
            String dlqTopic = message.originTopic() + "." + subscription.group() + ".dlq";
            retries.publishDlq(message, dlqTopic, reason);
            if (metrics != null) {
                metrics.recordDlq(subscription.id());
            }
            return outcome(
                    subscription, "dlq", startedNanos, AcknowledgeType.ACCEPT);
        } catch (RuntimeException unavailable) {
            return outcome(
                    subscription, "released", startedNanos, AcknowledgeType.RELEASE);
        }
    }

    private AcknowledgeType outcome(
            SubscriptionConfig subscription,
            String code,
            long startedNanos,
            AcknowledgeType acknowledgement) {
        if (metrics != null) {
            metrics.recordPush(subscription.id(), code, startedNanos);
        }
        return acknowledgement;
    }

}
