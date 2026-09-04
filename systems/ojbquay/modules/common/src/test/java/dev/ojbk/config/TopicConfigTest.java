package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class TopicConfigTest {

    @Test
    void acceptsAValidTopicPolicy() {
        TopicConfig topic = new TopicConfig(
                "orders.created",
                1,
                12,
                3,
                false,
                1_048_576,
                259_200_000L,
                5_000,
                "0123456789abcdef0123456789abcdef",
                "alice",
                true);

        assertThat(topic.name()).isEqualTo("orders.created");
    }

    @Test
    void rejectsInvalidNamesAndHardMessageLimitViolations() {
        assertThatThrownBy(() -> valid("_internal", 1_048_576))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("name");
        assertThatThrownBy(() -> valid("orders", 4_194_305))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("maxMessageBytes");
    }

    private static TopicConfig valid(String name, int maxMessageBytes) {
        return new TopicConfig(
                name,
                1,
                3,
                1,
                false,
                maxMessageBytes,
                259_200_000L,
                1_000,
                "0123456789abcdef0123456789abcdef",
                "alice",
                true);
    }
}
