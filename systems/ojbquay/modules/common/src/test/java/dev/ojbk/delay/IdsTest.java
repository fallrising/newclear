package dev.ojbk.delay;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Random;
import org.junit.jupiter.api.Test;

final class IdsTest {

    @Test
    void createsTimeOrderedRfc4122VersionSevenIds() {
        String first = Ids.uuidV7(
                Clock.fixed(Instant.ofEpochMilli(1_000), ZoneOffset.UTC), new Random(1));
        String second = Ids.uuidV7(
                Clock.fixed(Instant.ofEpochMilli(2_000), ZoneOffset.UTC), new Random(1));

        assertThat(java.util.UUID.fromString(first).version()).isEqualTo(7);
        assertThat(java.util.UUID.fromString(first).variant()).isEqualTo(2);
        assertThat(first).isLessThan(second);
    }
}
