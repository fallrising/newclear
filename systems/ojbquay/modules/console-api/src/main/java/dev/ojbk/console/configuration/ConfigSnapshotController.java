package dev.ojbk.console.configuration;

import dev.ojbk.console.api.ApiResponse;
import dev.ojbk.console.group.GroupService;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import dev.ojbk.console.subscription.SubscriptionService;
import dev.ojbk.console.topic.TopicService;
import java.time.Clock;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/config")
public final class ConfigSnapshotController {
    private final TopicService topics;
    private final GroupService groups;
    private final SubscriptionService subscriptions;
    private final ResourceAuthorization authorization;
    private final Clock clock = Clock.systemUTC();

    ConfigSnapshotController(
            TopicService topics,
            GroupService groups,
            SubscriptionService subscriptions,
            ResourceAuthorization authorization) {
        this.topics = topics;
        this.groups = groups;
        this.subscriptions = subscriptions;
        this.authorization = authorization;
    }

    @GetMapping("/snapshot")
    ApiResponse<ConfigSnapshot> snapshot(Authentication authentication) {
        Actor actor = Actor.from(authentication);
        authorization.requireOperator(actor);
        return ApiResponse.ok(new ConfigSnapshot(
                clock.instant(), topics.list(actor), groups.list(actor), subscriptions.list(actor)));
    }
}
