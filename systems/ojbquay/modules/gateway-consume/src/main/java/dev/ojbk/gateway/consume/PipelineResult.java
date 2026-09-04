package dev.ojbk.gateway.consume;

import java.util.Objects;

public record PipelineResult(
        PipelineAction action, PushMessage message, byte[] body) {

    public PipelineResult {
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(message, "message");
        body = Objects.requireNonNull(body, "body").clone();
    }

    @Override
    public byte[] body() {
        return body.clone();
    }
}
