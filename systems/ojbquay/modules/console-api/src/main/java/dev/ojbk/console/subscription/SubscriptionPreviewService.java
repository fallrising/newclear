package dev.ojbk.console.subscription;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.ojbk.config.DeliveryPolicy;
import dev.ojbk.config.PullSubscriptionSpec;
import dev.ojbk.config.PushSubscriptionSpec;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.pipeline.CelFilter;
import dev.ojbk.pipeline.MessageVariables;
import dev.ojbk.pipeline.TransitMapper;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.springframework.stereotype.Service;

@Service
public final class SubscriptionPreviewService implements AutoCloseable {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final CelFilter cel = new CelFilter();
    private final TransitMapper transit = new TransitMapper();

    public SubscriptionPreview preview(PreviewSubscriptionRequest request) {
        java.util.Objects.requireNonNull(request, "request");
        PreviewMessage message =
                java.util.Objects.requireNonNull(request.sampleMessage(), "sampleMessage");
        DeliveryPolicy policy = policy(request.spec());
        cel.validate(policy.filterCel());
        transit.validate(policy.transit());
        byte[] value = decode(message.valueBase64());

        if (!policy.shadowTraffic() && isShadow(message)) {
            return filtered("SHADOW");
        }
        if (!message.tags().containsAll(policy.tags())) {
            return filtered("TAGS");
        }
        MessageVariables variables = new MessageVariables(
                message.key(),
                message.tags(),
                message.headers(),
                parse(value),
                value);
        if (!cel.matches(policy.filterCel(), variables)) {
            return filtered("CEL");
        }
        if (policy.transit().isEmpty()) {
            return deliver(value);
        }
        String transformed = transit.map(
                new String(value, StandardCharsets.UTF_8), policy.transit());
        return deliver(transformed.getBytes(StandardCharsets.UTF_8));
    }

    private static DeliveryPolicy policy(java.util.Map<String, Object> spec) {
        Object mode = spec.get("mode");
        if ("PUSH".equals(mode)) {
            return PushSubscriptionSpec.from(spec);
        }
        if ("PULL".equals(mode)) {
            return PullSubscriptionSpec.from(spec);
        }
        throw new IllegalArgumentException("spec.mode must be PUSH or PULL");
    }

    private static byte[] decode(String encoded) {
        try {
            byte[] value = Base64.getDecoder().decode(encoded);
            if (value.length > MessageLimits.MAX_VALUE_BYTES) {
                throw new IllegalArgumentException(
                        "sample value exceeds 4194304 bytes");
            }
            return value;
        } catch (IllegalArgumentException invalid) {
            if (invalid.getMessage() != null
                    && invalid.getMessage().startsWith("sample value")) {
                throw invalid;
            }
            throw new IllegalArgumentException(
                    "sample value must be valid Base64", invalid);
        }
    }

    private Object parse(byte[] value) {
        try {
            return objectMapper.readValue(value, Object.class);
        } catch (IOException invalidJson) {
            return null;
        }
    }

    private static boolean isShadow(PreviewMessage message) {
        return "1".equals(message.headers().get("x-ojbk-shadow"))
                || "1".equals(message.headers().get("x-mq-shadow"));
    }

    private static SubscriptionPreview filtered(String reason) {
        return new SubscriptionPreview("FILTERED", reason, "");
    }

    private static SubscriptionPreview deliver(byte[] value) {
        return new SubscriptionPreview(
                "DELIVER", "", Base64.getEncoder().encodeToString(value));
    }

    @Override
    @PreDestroy
    public void close() {
        cel.close();
    }
}
