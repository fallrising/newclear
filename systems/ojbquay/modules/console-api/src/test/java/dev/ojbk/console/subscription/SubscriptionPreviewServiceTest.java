package dev.ojbk.console.subscription;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class SubscriptionPreviewServiceTest {
    @Test
    void evaluatesSharedPolicyAndReturnsTheTransformedBody() {
        try (SubscriptionPreviewService service =
                new SubscriptionPreviewService()) {
            SubscriptionPreview response = service.preview(
                    new PreviewSubscriptionRequest(
                            spec(),
                            new PreviewMessage(
                                    "order-42",
                                    base64("""
                                            {"amount":150,"user":{"id":"u42"}}
                                            """),
                                    List.of("paid"),
                                    Map.of("traceparent", "00-test"))));

            assertThat(response.action()).isEqualTo("DELIVER");
            assertThat(new String(
                            Base64.getDecoder().decode(response.valueBase64()),
                            StandardCharsets.UTF_8))
                    .contains("\"uid\":\"u42\"");
        }
    }

    @Test
    void reportsTagAndShadowFilteringWithoutReturningPayload() {
        try (SubscriptionPreviewService service =
                new SubscriptionPreviewService()) {
            SubscriptionPreview missingTag = service.preview(
                    new PreviewSubscriptionRequest(
                            spec(),
                            new PreviewMessage(
                                    "order-42",
                                    base64("{\"amount\":150}"),
                                    List.of(),
                                    Map.of())));
            SubscriptionPreview shadow = service.preview(
                    new PreviewSubscriptionRequest(
                            spec(),
                            new PreviewMessage(
                                    "order-42",
                                    base64("{\"amount\":150}"),
                                    List.of("paid"),
                                    Map.of("x-ojbk-shadow", "1"))));

            assertThat(missingTag)
                    .extracting(
                            SubscriptionPreview::action,
                            SubscriptionPreview::reason,
                            SubscriptionPreview::valueBase64)
                    .containsExactly("FILTERED", "TAGS", "");
            assertThat(shadow.reason()).isEqualTo("SHADOW");
        }
    }

    @Test
    void rejectsMalformedBase64BeforeEvaluation() {
        try (SubscriptionPreviewService service =
                new SubscriptionPreviewService()) {
            assertThatThrownBy(() -> service.preview(
                            new PreviewSubscriptionRequest(
                                    spec(),
                                    new PreviewMessage(
                                            "",
                                            "not-base64!",
                                            List.of(),
                                            Map.of()))))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("Base64");
        }
    }

    private static Map<String, Object> spec() {
        return Map.ofEntries(
                Map.entry("mode", "PUSH"),
                Map.entry("concurrency", 4),
                Map.entry("maxTps", 100),
                Map.entry("filterCel", "body.amount > 100"),
                Map.entry("tags", List.of("paid")),
                Map.entry("transit", Map.of("$.uid", "$.user.id")),
                Map.entry("ordered", false),
                Map.entry("shadowTraffic", false),
                Map.entry(
                        "push",
                        Map.of(
                                "urls", List.of("https://service.example/events"),
                                "method", "POST",
                                "timeoutMs", 5_000,
                                "retryIntervalsMs", List.of(150))));
    }

    private static String base64(String value) {
        return Base64.getEncoder()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
}
