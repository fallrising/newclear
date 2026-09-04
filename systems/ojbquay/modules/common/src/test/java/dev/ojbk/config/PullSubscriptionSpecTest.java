package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class PullSubscriptionSpecTest {
    @Test
    void parsesBoundedPullPolicy() {
        PullSubscriptionSpec spec = PullSubscriptionSpec.from(validSpec());

        assertThat(spec.concurrency()).isEqualTo(64);
        assertThat(spec.maxTps()).isEqualTo(1_000);
        assertThat(spec.maxBatch()).isEqualTo(32);
        assertThat(spec.ackTimeoutMs()).isEqualTo(30_000);
        assertThat(spec.maxRetry()).isEqualTo(3);
        assertThat(spec.tags()).containsExactly("paid");
        assertThat(spec.transit()).containsEntry("$.uid", "$.user.id");
        assertThat(spec.maxInflight()).isEqualTo(64);
    }

    @Test
    void rejectsOrderedOrUnboundedPullPolicies() {
        assertThatThrownBy(() -> PullSubscriptionSpec.from(with("ordered", true)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ordered");
        assertThatThrownBy(() -> PullSubscriptionSpec.from(
                        withPull(Map.of("maxBatch", 65, "ackTimeoutMs", 30_000))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxBatch");
        assertThatThrownBy(() -> PullSubscriptionSpec.from(
                        withPull(Map.of("maxBatch", 32, "ackTimeoutMs", 999))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("ackTimeoutMs");
        assertThatThrownBy(() -> PullSubscriptionSpec.from(
                        withPull(Map.of(
                                "maxBatch", 32,
                                "ackTimeoutMs", 30_000,
                                "maxRetry", 101))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxRetry");
    }

    private static Map<String, Object> validSpec() {
        return Map.ofEntries(
                Map.entry("mode", "PULL"),
                Map.entry("concurrency", 64),
                Map.entry("maxTps", 1_000),
                Map.entry("filterCel", "body.amount > 0"),
                Map.entry("tags", List.of("paid")),
                Map.entry("transit", Map.of("$.uid", "$.user.id")),
                Map.entry("ordered", false),
                Map.entry("dlqEnabled", true),
                Map.entry("shadowTraffic", false),
                Map.entry(
                        "pull",
                        Map.of(
                                "maxBatch", 32,
                                "ackTimeoutMs", 30_000,
                                "maxRetry", 3)));
    }

    private static Map<String, Object> with(String key, Object value) {
        var copy = new java.util.HashMap<>(validSpec());
        copy.put(key, value);
        return Map.copyOf(copy);
    }

    private static Map<String, Object> withPull(Map<String, Object> pull) {
        return with("pull", pull);
    }
}
