package dev.ojbk.gateway.produce;

import ojbk.v1.Code;
import java.util.Objects;

public record ProducerResult(Code code, String message, BrokerAck ack) {

    public ProducerResult {
        Objects.requireNonNull(code, "code");
        message = message == null ? "" : message;
        if (code == Code.OK && ack == null) {
            throw new IllegalArgumentException("successful result requires an acknowledgement");
        }
        if (code != Code.OK && ack != null) {
            throw new IllegalArgumentException("failed result cannot contain an acknowledgement");
        }
    }

    public static ProducerResult ok(BrokerAck ack) {
        return new ProducerResult(Code.OK, "", ack);
    }

    public static ProducerResult error(Code code, String message) {
        return new ProducerResult(code, message, null);
    }
}
