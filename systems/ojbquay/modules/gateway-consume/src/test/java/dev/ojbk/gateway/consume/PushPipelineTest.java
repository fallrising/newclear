package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.ojbk.config.PushSubscriptionSpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class PushPipelineTest {
    @Test
    void filtersShadowTagsAndCelWithoutDeliveryIo() {
        try (PushPipeline pipeline = new PushPipeline()) {
            PushSubscriptionSpec spec = spec(false, "body.amount > 100");

            assertThat(pipeline.apply(
                                    message(
                                            List.of("paid", "priority"),
                                            Map.of(
                                                    "x-ojbk-shadow", "1",
                                                    "traceparent", "00-test"),
                                            "{\"amount\":150}"),
                                    spec)
                            .action())
                    .isEqualTo(PipelineAction.FILTERED);
            assertThat(pipeline.apply(
                                    message(
                                            List.of("paid"),
                                            Map.of("traceparent", "00-test"),
                                            "{\"amount\":150}"),
                                    spec)
                            .action())
                    .isEqualTo(PipelineAction.FILTERED);
            assertThat(pipeline.apply(
                                    message(
                                            List.of("paid", "priority"),
                                            Map.of("traceparent", "00-test"),
                                            "{\"amount\":50}"),
                                    spec)
                            .action())
                    .isEqualTo(PipelineAction.FILTERED);
        }
    }

    @Test
    void transformsMatchingJsonAndPreservesDeliveryMetadata() {
        try (PushPipeline pipeline = new PushPipeline()) {
            PipelineResult result = pipeline.apply(
                    message(
                            List.of("paid", "priority"),
                            Map.of("traceparent", "00-test"),
                            """
                            {"amount":150,"user":{"id":"u-42"}}
                            """),
                    spec(false, "body.amount > 100"));

            assertThat(result.action()).isEqualTo(PipelineAction.DELIVER);
            assertThat(new String(result.body(), StandardCharsets.UTF_8))
                    .contains("\"uid\":\"u-42\"")
                    .contains("\"amount\":150");
            assertThat(result.message().headers())
                    .containsEntry("traceparent", "00-test");
        }
    }

    @Test
    void marksInvalidTransitInputAsDeterministicPipelineError() {
        try (PushPipeline pipeline = new PushPipeline()) {
            PipelineResult result = pipeline.apply(
                    message(
                            List.of("paid", "priority"),
                            Map.of(),
                            "not-json"),
                    spec(false, ""));

            assertThat(result.action()).isEqualTo(PipelineAction.ERROR);
            assertThat(result.body()).isEmpty();
        }
    }

    @Test
    void rejectsInvalidCelAndTransitPathsDuringWorkerPreflight() {
        PushSubscriptionSpec base = spec(false, "");
        try (PushPipeline pipeline = new PushPipeline()) {
            PushSubscriptionSpec badCel = copy(base, "not valid CEL !", base.transit());
            PushSubscriptionSpec badTransit =
                    copy(base, "", Map.of("uid", "$.user.id"));

            assertThatThrownBy(() -> pipeline.validate(badCel))
                    .isInstanceOf(IllegalArgumentException.class);
            assertThatThrownBy(() -> pipeline.validate(badTransit))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("target path");
        }
    }

    private static PushSubscriptionSpec copy(
            PushSubscriptionSpec base,
            String filterCel,
            Map<String, String> transit) {
        return new PushSubscriptionSpec(
                base.concurrency(),
                base.maxTps(),
                filterCel,
                base.tags(),
                transit,
                base.ordered(),
                base.orderKeySource(),
                base.orderKeyExpr(),
                base.dlqEnabled(),
                base.shadowTraffic(),
                base.http());
    }

    private static PushMessage message(
            List<String> tags, Map<String, String> headers, String body) {
        return new PushMessage(
                "orders",
                1,
                42,
                Instant.parse("2026-07-29T12:00:00Z"),
                "order-42",
                body.getBytes(StandardCharsets.UTF_8),
                tags,
                headers,
                1);
    }

    private static PushSubscriptionSpec spec(
            boolean shadowTraffic, String filterCel) {
        return PushSubscriptionSpec.from(Map.ofEntries(
                Map.entry("mode", "PUSH"),
                Map.entry("concurrency", 8),
                Map.entry("maxTps", 100),
                Map.entry("filterCel", filterCel),
                Map.entry("tags", List.of("paid", "priority")),
                Map.entry("transit", Map.of("$.uid", "$.user.id")),
                Map.entry("ordered", false),
                Map.entry("dlqEnabled", true),
                Map.entry("shadowTraffic", shadowTraffic),
                Map.entry(
                        "push",
                        Map.of(
                                "urls", List.of("https://service.example/callback"),
                                "method", "POST",
                                "timeoutMs", 5_000,
                                "retryIntervalsMs", List.of(150, 300, 600)))));
    }
}
