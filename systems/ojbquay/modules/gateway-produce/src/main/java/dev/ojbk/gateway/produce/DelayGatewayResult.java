package dev.ojbk.gateway.produce;

import ojbk.v1.Code;
import java.util.Objects;

public record DelayGatewayResult(Code code, String message, String delayId) {

    public DelayGatewayResult {
        Objects.requireNonNull(code, "code");
        message = message == null ? "" : message;
        delayId = delayId == null ? "" : delayId;
    }

    static DelayGatewayResult ok(String delayId) {
        return new DelayGatewayResult(Code.OK, "", delayId);
    }

    static DelayGatewayResult error(Code code, String message, String delayId) {
        return new DelayGatewayResult(code, message, delayId);
    }
}
