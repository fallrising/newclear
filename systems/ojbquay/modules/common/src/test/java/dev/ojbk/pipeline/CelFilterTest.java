package dev.ojbk.pipeline;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class CelFilterTest {
    private static final Duration COLD_START_TIMEOUT = Duration.ofSeconds(5);

    @Test
    void evaluatesDeclaredMessageVariablesAndFailsClosed() throws InterruptedException {
        try (CelFilter filter = new CelFilter()) {
            MessageVariables variables = new MessageVariables(
                    "order-42",
                    List.of("paid"),
                    Map.of("region", "eu"),
                    Map.of("amount", 15_000L),
                    new byte[0]);

            assertThat(eventuallyMatches(
                            filter,
                            "key == 'order-42' && 'paid' in tags && body.amount > 10000",
                            variables))
                    .isTrue();
            assertThat(filter.matches("body.missing > 0", variables)).isFalse();
            assertThat(filter.matches("not valid CEL !", variables)).isFalse();
        }
    }

    private static boolean eventuallyMatches(
            CelFilter filter, String expression, MessageVariables variables)
            throws InterruptedException {
        long deadline = System.nanoTime() + COLD_START_TIMEOUT.toNanos();
        do {
            if (filter.matches(expression, variables)) {
                return true;
            }
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        return false;
    }
}
