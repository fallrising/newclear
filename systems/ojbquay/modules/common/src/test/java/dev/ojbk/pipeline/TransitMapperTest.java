package dev.ojbk.pipeline;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

final class TransitMapperTest {

    @Test
    void mapsExistingJsonPathsAndSkipsMissingSources() {
        TransitMapper mapper = new TransitMapper();

        String mapped = mapper.map(
                """
                {"uid":"u-1","order":{"amount":42}}
                """,
                Map.of(
                        "$.user.id", "$.uid",
                        "$.total", "$.order.amount",
                        "$.ignored", "$.missing"));

        assertThat(mapped).isEqualTo(
                "{\"uid\":\"u-1\",\"order\":{\"amount\":42},\"total\":42,\"user\":{\"id\":\"u-1\"}}");
    }

    @Test
    void rejectsInvalidTargetAndSourcePathsDuringPreflight() {
        TransitMapper mapper = new TransitMapper();

        assertThatThrownBy(() -> mapper.validate(Map.of("uid", "$.user.id")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("target path");
        assertThatThrownBy(() -> mapper.validate(Map.of("$.uid", "$.[")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("source path");
    }
}
