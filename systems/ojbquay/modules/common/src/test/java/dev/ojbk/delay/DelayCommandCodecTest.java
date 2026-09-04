package dev.ojbk.delay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class DelayCommandCodecTest {
    private final DelayCommandCodec codec = new DelayCommandCodec();

    @Test
    void roundTripsAnImmutableVersionedAddCommand() {
        DelayCommand command = new DelayCommand(
                1,
                DelayAction.ADD,
                "01900000-0000-7000-8000-000000000001",
                "orders",
                2_000,
                "value".getBytes(StandardCharsets.UTF_8),
                "order-1",
                List.of("paid"),
                Map.of("traceparent", "00-test"),
                1,
                1_000L,
                3,
                10_000L);

        DelayCommand decoded = codec.decode(codec.encode(command));

        assertThat(decoded).isEqualTo(command);
        assertThat(decoded.value()).isEqualTo("value".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void requiresFiniteRecurrenceAndValidCancelShape() {
        assertThatThrownBy(() -> new DelayCommand(
                        1,
                        DelayAction.ADD,
                        "delay-1",
                        "orders",
                        2_000,
                        new byte[0],
                        null,
                        List.of(),
                        Map.of(),
                        null,
                        1_000L,
                        0,
                        null))
                .isInstanceOf(IllegalArgumentException.class);

        DelayCommand cancel = DelayCommand.cancel("delay-1", "orders");
        assertThat(cancel.action()).isEqualTo(DelayAction.CANCEL);
        assertThat(cancel.value()).isEmpty();

        assertThatThrownBy(() -> new DelayCommand(
                        1,
                        DelayAction.CANCEL,
                        "delay-1",
                        "orders",
                        0,
                        new byte[0],
                        "unexpected-key",
                        List.of(),
                        Map.of(),
                        null,
                        null,
                        0,
                        null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void boundsRecurrenceAndDoesNotLeakInvalidCommandPayload() {
        assertThatThrownBy(() -> new DelayCommand(
                        1,
                        DelayAction.ADD,
                        "delay-1",
                        "orders",
                        2_000,
                        new byte[0],
                        null,
                        List.of(),
                        Map.of(),
                        null,
                        DelayCommand.MAX_DELAY_MS + 1,
                        2,
                        null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("30 day");

        String secret = "private-message-payload";
        assertThatThrownBy(() -> codec.decode(
                        ("{\"value\":\"" + secret + "\"").getBytes(StandardCharsets.UTF_8)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("delay command cannot be decoded")
                .hasNoCause()
                .hasMessageNotContaining(secret);
    }
}
