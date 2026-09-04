package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;

import dev.ojbk.config.PushSubscriptionSpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class OrderKeyExtractorTest {
    @Test
    void extractsKafkaKeyHeaderAndJsonPath() {
        PushMessage message = new PushMessage(
                "orders",
                0,
                1,
                Instant.EPOCH,
                "kafka-key",
                "{\"user\":{\"id\":42}}".getBytes(StandardCharsets.UTF_8),
                List.of(),
                Map.of("tenant", "eu"),
                1);
        OrderKeyExtractor extractor = new OrderKeyExtractor();

        assertThat(extractor.extract(message, spec("KEY", ""))).isEqualTo("kafka-key");
        assertThat(extractor.extract(message, spec("HEADER", "tenant"))).isEqualTo("eu");
        assertThat(extractor.extract(message, spec("JSONPATH", "$.user.id"))).isEqualTo("42");
    }

    private static PushSubscriptionSpec spec(String source, String expression) {
        return PushSubscriptionSpec.from(Map.ofEntries(
                Map.entry("mode", "PUSH"),
                Map.entry("concurrency", 2),
                Map.entry("maxTps", 100),
                Map.entry("ordered", true),
                Map.entry("orderKeySource", source),
                Map.entry("orderKeyExpr", expression),
                Map.entry("dlqEnabled", true),
                Map.entry(
                        "push",
                        Map.of(
                                "urls", List.of("https://service.example/callback"),
                                "method", "POST",
                                "timeoutMs", 1_000,
                                "retryIntervalsMs", List.of(150, 300)))));
    }
}
