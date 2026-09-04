package dev.ojbk.gateway.consume;

import ojbk.v1.Code;

public record PullAckResult(Code code, String message) {
    public PullAckResult {
        java.util.Objects.requireNonNull(code, "code");
        message = message == null ? "" : message;
    }

    static PullAckResult ok() {
        return new PullAckResult(Code.OK, "");
    }

    static PullAckResult invalid(String message) {
        return new PullAckResult(Code.INVALID_ARGUMENT, message);
    }

    static PullAckResult unavailable() {
        return new PullAckResult(
                Code.BROKER_UNAVAILABLE, "pull acknowledgement failed");
    }
}
