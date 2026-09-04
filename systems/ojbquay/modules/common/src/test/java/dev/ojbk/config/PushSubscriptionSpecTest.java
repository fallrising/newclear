package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class PushSubscriptionSpecTest {
    @Test
    void convertsAValidatedImmutablePushPolicy() {
        PushSubscriptionSpec spec = PushSubscriptionSpec.from(validSpec());

        assertThat(spec.concurrency()).isEqualTo(8);
        assertThat(spec.maxTps()).isEqualTo(100);
        assertThat(spec.tags()).containsExactly("paid", "priority");
        assertThat(spec.transit()).containsEntry("$.uid", "$.user.id");
        assertThat(spec.http().method()).isEqualTo("POST");
        assertThat(spec.retryDelayMs(0)).hasValue(150);
        assertThat(spec.retryDelayMs(1)).hasValue(300);
        assertThat(spec.retryDelayMs(2)).hasValue(300);
        assertThat(spec.retryDelayMs(100)).hasValue(300);
    }

    @Test
    void rejectsUnboundedInvalidAndUnsafePolicyFields() {
        Map<String, Object> tooMuchConcurrency =
                new java.util.HashMap<>(validSpec());
        tooMuchConcurrency.put("concurrency", 501);
        assertThatThrownBy(() -> PushSubscriptionSpec.from(tooMuchConcurrency))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("concurrency");

        Map<String, Object> invalidRetry = new java.util.HashMap<>(validSpec());
        invalidRetry.put(
                "push",
                Map.of(
                        "urls", List.of("https://service.example/callback"),
                        "method", "POST",
                        "timeoutMs", 5_000,
                        "retryIntervalsMs", List.of(-1)));
        assertThatThrownBy(() -> PushSubscriptionSpec.from(invalidRetry))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("-1");

        Map<String, Object> unsafeUrl = new java.util.HashMap<>(validSpec());
        unsafeUrl.put(
                "push",
                Map.of(
                        "urls", List.of("https://user:secret@service.example/callback"),
                        "method", "POST",
                        "timeoutMs", 5_000,
                        "retryIntervalsMs", List.of(150)));
        assertThatThrownBy(() -> PushSubscriptionSpec.from(unsafeUrl))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("credentials");
    }

    private static Map<String, Object> validSpec() {
        return Map.ofEntries(
                Map.entry("mode", "PUSH"),
                Map.entry("concurrency", 8),
                Map.entry("maxTps", 100),
                Map.entry("filterCel", "body.amount > 100"),
                Map.entry("tags", List.of("paid", "priority")),
                Map.entry("transit", Map.of("$.uid", "$.user.id")),
                Map.entry("ordered", true),
                Map.entry("orderKeySource", "HEADER"),
                Map.entry("orderKeyExpr", "x-order-id"),
                Map.entry("dlqEnabled", true),
                Map.entry("shadowTraffic", false),
                Map.entry(
                        "push",
                        Map.ofEntries(
                                Map.entry(
                                        "urls",
                                        List.of("https://service.example/callback")),
                                Map.entry("method", "POST"),
                                Map.entry("timeoutMs", 5_000),
                                Map.entry(
                                        "retryIntervalsMs",
                                        List.of(150, 300, -1)),
                                Map.entry(
                                        "headers",
                                        Map.of("x-service-token", "test-only")))));
    }
}
