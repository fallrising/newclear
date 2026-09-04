package dev.ojbk.console.subscription;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record UpdateSubscriptionRequest(@NotNull Map<String, Object> spec) {

    public UpdateSubscriptionRequest {
        spec = spec == null ? null : Map.copyOf(spec);
    }
}
