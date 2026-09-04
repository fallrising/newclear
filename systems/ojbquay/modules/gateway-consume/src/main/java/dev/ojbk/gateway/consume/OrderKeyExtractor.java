package dev.ojbk.gateway.consume;

import com.jayway.jsonpath.JsonPath;
import dev.ojbk.config.PushSubscriptionSpec;
import java.nio.charset.StandardCharsets;

public final class OrderKeyExtractor {
    public String extract(PushMessage message, PushSubscriptionSpec spec) {
        java.util.Objects.requireNonNull(message, "message");
        java.util.Objects.requireNonNull(spec, "spec");
        Object extracted = switch (spec.orderKeySource()) {
            case KEY -> message.key();
            case HEADER -> message.headers().get(spec.orderKeyExpr());
            case JSONPATH -> JsonPath.parse(
                            new String(message.value(), StandardCharsets.UTF_8))
                    .read(spec.orderKeyExpr());
        };
        if (extracted == null || extracted.toString().isBlank()) {
            throw new IllegalArgumentException("order key is missing");
        }
        if (extracted instanceof java.util.Map<?, ?>
                || extracted instanceof java.util.Collection<?>) {
            throw new IllegalArgumentException("order key must be scalar");
        }
        String key = extracted.toString();
        if (key.length() > 1_024) {
            throw new IllegalArgumentException("order key is too long");
        }
        return key;
    }
}
