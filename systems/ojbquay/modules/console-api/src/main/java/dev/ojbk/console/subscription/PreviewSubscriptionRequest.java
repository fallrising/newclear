package dev.ojbk.console.subscription;

import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record PreviewSubscriptionRequest(
        @NotNull Map<String, Object> spec,
        @NotNull PreviewMessage sampleMessage) {

    public PreviewSubscriptionRequest {
        spec = spec == null ? null : Map.copyOf(spec);
    }
}
