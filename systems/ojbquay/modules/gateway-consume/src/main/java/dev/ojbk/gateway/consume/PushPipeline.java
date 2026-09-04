package dev.ojbk.gateway.consume;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.config.DeliveryPolicy;
import dev.ojbk.pipeline.CelFilter;
import dev.ojbk.pipeline.MessageVariables;
import dev.ojbk.pipeline.TransitMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Objects;

public final class PushPipeline implements AutoCloseable {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CelFilter celFilter = new CelFilter();
    private final TransitMapper transitMapper = new TransitMapper();

    public void validate(DeliveryPolicy spec) {
        Objects.requireNonNull(spec, "spec");
        celFilter.validate(spec.filterCel());
        transitMapper.validate(spec.transit());
    }

    public PipelineResult apply(PushMessage message, DeliveryPolicy spec) {
        Objects.requireNonNull(message, "message");
        Objects.requireNonNull(spec, "spec");
        if (!spec.shadowTraffic() && isShadow(message)) {
            return filtered(message);
        }
        if (!message.tags().containsAll(spec.tags())) {
            return filtered(message);
        }
        Object parsedBody = parse(message.value());
        MessageVariables variables = new MessageVariables(
                message.key(),
                message.tags(),
                message.headers(),
                parsedBody,
                message.value());
        if (!celFilter.matches(spec.filterCel(), variables)) {
            return filtered(message);
        }
        if (spec.transit().isEmpty()) {
            return new PipelineResult(PipelineAction.DELIVER, message, message.value());
        }
        try {
            String transformed = transitMapper.map(
                    new String(message.value(), StandardCharsets.UTF_8),
                    spec.transit());
            return new PipelineResult(
                    PipelineAction.DELIVER,
                    message,
                    transformed.getBytes(StandardCharsets.UTF_8));
        } catch (IllegalArgumentException invalid) {
            return new PipelineResult(PipelineAction.ERROR, message, new byte[0]);
        }
    }

    private Object parse(byte[] value) {
        try {
            return objectMapper.readValue(value, Object.class);
        } catch (IOException invalidJson) {
            return null;
        }
    }

    private static boolean isShadow(PushMessage message) {
        return "1".equals(message.headers().get("x-ojbk-shadow"))
                || "1".equals(message.headers().get("x-mq-shadow"));
    }

    private static PipelineResult filtered(PushMessage message) {
        return new PipelineResult(PipelineAction.FILTERED, message, new byte[0]);
    }

    @Override
    public void close() {
        celFilter.close();
    }
}
