package dev.ojbk.config;

import java.util.Map;

public record SubscriptionConfig(
        long id,
        String group,
        String topic,
        String owner,
        boolean enabled,
        Map<String, Object> spec) {

    public SubscriptionConfig {
        if (id < 1) {
            throw new IllegalArgumentException("subscription id must be positive");
        }
        if (group == null || group.isBlank()) {
            throw new IllegalArgumentException("subscription group must not be blank");
        }
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("subscription topic must not be blank");
        }
        if (owner == null || owner.isBlank()) {
            throw new IllegalArgumentException("subscription owner must not be blank");
        }
        spec = Map.copyOf(java.util.Objects.requireNonNull(spec, "spec"));
        Object mode = spec.get("mode");
        if ("PUSH".equals(mode)) {
            PushSubscriptionSpec.from(spec);
        } else if ("PULL".equals(mode)) {
            PullSubscriptionSpec.from(spec);
        } else {
            throw new IllegalArgumentException("subscription spec.mode must be PUSH or PULL");
        }
    }
}
