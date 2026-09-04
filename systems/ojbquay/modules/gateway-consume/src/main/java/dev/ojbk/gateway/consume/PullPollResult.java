package dev.ojbk.gateway.consume;

import ojbk.v1.Code;
import java.util.List;

record PullPollResult(Code code, String message, List<PullDelivery> deliveries) {
    PullPollResult {
        java.util.Objects.requireNonNull(code, "code");
        message = message == null ? "" : message;
        deliveries = List.copyOf(deliveries);
    }

    static PullPollResult ok(List<PullDelivery> deliveries) {
        return new PullPollResult(Code.OK, "", deliveries);
    }

    static PullPollResult invalid(String message) {
        return new PullPollResult(Code.INVALID_ARGUMENT, message, List.of());
    }

    static PullPollResult notFound() {
        return new PullPollResult(
                Code.TOPIC_NOT_FOUND,
                "enabled pull subscription does not exist",
                List.of());
    }

    static PullPollResult unavailable() {
        return new PullPollResult(
                Code.BROKER_UNAVAILABLE, "pull worker is unavailable", List.of());
    }
}
