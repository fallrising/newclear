package dev.ojbk.console.configuration;

import dev.ojbk.console.group.GroupView;
import dev.ojbk.console.subscription.SubscriptionView;
import dev.ojbk.console.topic.TopicView;
import java.time.Instant;
import java.util.List;

public record ConfigSnapshot(
        Instant generatedAt,
        List<TopicView> topics,
        List<GroupView> groups,
        List<SubscriptionView> subscriptions) {

    public ConfigSnapshot {
        topics = List.copyOf(topics);
        groups = List.copyOf(groups);
        subscriptions = List.copyOf(subscriptions);
    }
}
