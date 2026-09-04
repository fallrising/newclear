package dev.ojbk.console.subscription;

import java.time.Instant;
import java.util.Map;

public record SubscriptionView(
        long id,
        long groupId,
        long topicId,
        Map<String, Object> spec,
        short state,
        long version,
        String owner,
        Instant createdAt,
        Instant updatedAt) {}
