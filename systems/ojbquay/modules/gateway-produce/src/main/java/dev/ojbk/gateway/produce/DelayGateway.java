package dev.ojbk.gateway.produce;

import ojbk.v1.Code;
import dev.ojbk.delay.DelayCommand;
import dev.ojbk.delay.Ids;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class DelayGateway {
    private final ProducerEngine producer;
    private final DelayCommandPublisher publisher;
    private final Clock clock;
    private final Duration directThreshold;

    public DelayGateway(
            ProducerEngine producer,
            DelayCommandPublisher publisher,
            Duration directThreshold) {
        this(producer, publisher, Clock.systemUTC(), directThreshold);
    }

    DelayGateway(
            ProducerEngine producer,
            DelayCommandPublisher publisher,
            Clock clock,
            Duration directThreshold) {
        this.producer = Objects.requireNonNull(producer, "producer");
        this.publisher = Objects.requireNonNull(publisher, "publisher");
        this.clock = Objects.requireNonNull(clock, "clock");
        if (directThreshold == null || directThreshold.isNegative()) {
            throw new IllegalArgumentException("directThreshold must not be negative");
        }
        this.directThreshold = directThreshold;
    }

    public DelayGatewayResult schedule(
            ProducerMessage message,
            String token,
            String requestedDelayId,
            long dueAtMs,
            Long loopIntervalMs,
            Integer loopTimes,
            Long expireAtMs) {
        String delayId = requestedDelayId == null || requestedDelayId.isBlank()
                ? Ids.uuidV7()
                : requestedDelayId;
        ProducerEngine.Validation validation = producer.validate(message, token, true);
        if (validation.error() != null) {
            return error(validation.error(), delayId);
        }
        if (!validation.topic().delayTopic()) {
            return DelayGatewayResult.error(
                    Code.INVALID_ARGUMENT, "topic does not allow delayed production", delayId);
        }
        long nowMs = clock.millis();
        if (dueAtMs > nowMs + DelayCommand.MAX_DELAY_MS) {
            return DelayGatewayResult.error(
                    Code.INVALID_ARGUMENT, "due time exceeds the 30 day limit", delayId);
        }
        int remaining = loopTimes == null ? 1 : loopTimes;
        if ((loopIntervalMs == null) != (loopTimes == null)) {
            return DelayGatewayResult.error(
                    Code.INVALID_ARGUMENT,
                    "loop interval and loop times must be supplied together",
                    delayId);
        }

        DelayCommand command;
        try {
            command = new DelayCommand(
                    DelayCommand.SUPPORTED_SCHEMA_VERSION,
                    dev.ojbk.delay.DelayAction.ADD,
                    delayId,
                    message.topic(),
                    dueAtMs,
                    message.value(),
                    message.key(),
                    message.tags(),
                    message.headers(),
                    message.partition(),
                    loopIntervalMs,
                    remaining,
                    expireAtMs);
        } catch (IllegalArgumentException invalid) {
            return DelayGatewayResult.error(Code.INVALID_ARGUMENT, invalid.getMessage(), delayId);
        }
        if (remaining == 1 && dueAtMs <= nowMs + directThreshold.toMillis()) {
            return direct(
                    producer.dispatchValidated(
                            validation.withHeader("x-ojbk-delay-id", delayId)),
                    delayId);
        }

        try {
            publisher.publish(command);
            return DelayGatewayResult.ok(delayId);
        } catch (RuntimeException unavailable) {
            return DelayGatewayResult.error(
                    Code.BROKER_UNAVAILABLE, "delay command publication failed", delayId);
        }
    }

    public DelayGatewayResult cancel(String topic, String token, String delayId) {
        ProducerMessage authorizationMessage =
                new ProducerMessage(topic, null, new byte[0], List.of(), Map.of(), null);
        ProducerEngine.Validation validation =
                producer.validate(authorizationMessage, token, false);
        if (validation.error() != null) {
            return error(validation.error(), delayId);
        }
        if (!validation.topic().delayTopic()) {
            return DelayGatewayResult.error(
                    Code.INVALID_ARGUMENT, "topic does not allow delayed production", delayId);
        }
        try {
            publisher.publish(DelayCommand.cancel(delayId, topic));
            return DelayGatewayResult.ok(delayId);
        } catch (IllegalArgumentException invalid) {
            return DelayGatewayResult.error(Code.INVALID_ARGUMENT, invalid.getMessage(), delayId);
        } catch (RuntimeException unavailable) {
            return DelayGatewayResult.error(
                    Code.BROKER_UNAVAILABLE, "delay cancellation publication failed", delayId);
        }
    }

    private static DelayGatewayResult direct(ProducerResult result, String delayId) {
        return result.code() == Code.OK
                ? DelayGatewayResult.ok(delayId)
                : error(result, delayId);
    }

    private static DelayGatewayResult error(ProducerResult result, String delayId) {
        return DelayGatewayResult.error(result.code(), result.message(), delayId);
    }
}
