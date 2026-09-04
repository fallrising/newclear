package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ConfigEventCodecTest {

    @Test
    void roundTripsTheNormativeConfigEnvelope() {
        ConfigEventCodec codec = new ConfigEventCodec();
        ConfigEvent event = new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                42,
                Instant.parse("2026-07-29T12:00:00Z"),
                "alice",
                Map.of("enabled", true, "partitions", 12));

        byte[] encoded = codec.encode(event);

        assertThat(new String(encoded)).contains("\"schemaVersion\":1", "\"entityType\":\"TOPIC\"");
        assertThat(codec.decode(encoded)).isEqualTo(event);
    }
}
