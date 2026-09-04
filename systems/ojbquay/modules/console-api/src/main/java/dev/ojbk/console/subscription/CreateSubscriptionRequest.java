package dev.ojbk.console.subscription;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.util.Map;

public record CreateSubscriptionRequest(
        @Min(1) long groupId, @Min(1) long topicId, @NotNull Map<String, Object> spec) {

    public CreateSubscriptionRequest {
        spec = spec == null ? null : Map.copyOf(spec);
    }
}
