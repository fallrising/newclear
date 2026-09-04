package dev.ojbk.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ConfigStoreTest {

    @Test
    void appliesOnlyMonotonicallyNewerSupportedRevisions() {
        ConfigStore store = new ConfigStore();
        ConfigEvent first = event(1, 7, "owner-a");
        ConfigEvent stale = event(1, 6, "owner-stale");
        ConfigEvent unsupported = event(2, 8, "owner-new");
        ConfigEvent invalid = new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                9,
                Instant.parse("2026-07-29T12:00:00Z"),
                "test",
                Map.of("owner", "broken"));

        assertThat(store.apply(first)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
        assertThat(store.apply(stale)).isEqualTo(ConfigStore.ApplyResult.STALE);
        assertThat(store.apply(unsupported))
                .isEqualTo(ConfigStore.ApplyResult.UNSUPPORTED_SCHEMA);
        assertThat(store.apply(invalid)).isEqualTo(ConfigStore.ApplyResult.INVALID_PAYLOAD);
        assertThat(store.get(ConfigEntityType.TOPIC, "orders"))
                .get()
                .isEqualTo(first);
        assertThat(store.topic("orders"))
                .get()
                .extracting(TopicConfig::owner)
                .isEqualTo("owner-a");
        assertThat(store.all()).hasSize(1);
    }

    @Test
    void atomicallyRemovesADeletedResource() {
        ConfigStore store = new ConfigStore();
        ConfigEvent active = event(1, 1, "owner-a");

        assertThat(store.apply(active)).isEqualTo(ConfigStore.ApplyResult.APPLIED);
        assertThat(store.delete(ConfigEntityType.TOPIC, "orders"))
                .get()
                .isEqualTo(active);

        assertThat(store.topic("orders")).isEmpty();
        assertThat(store.get(ConfigEntityType.TOPIC, "orders")).isEmpty();
    }

    private static ConfigEvent event(int schemaVersion, long version, String owner) {
        return new ConfigEvent(
                schemaVersion,
                ConfigEntityType.TOPIC,
                "orders",
                version,
                Instant.parse("2026-07-29T12:00:00Z"),
                "test",
                Map.ofEntries(
                        Map.entry("name", "orders"),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", false),
                        Map.entry("maxMessageBytes", 1_048_576),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 1_000),
                        Map.entry("token", "0123456789abcdef0123456789abcdef"),
                        Map.entry("owner", owner),
                        Map.entry("enabled", true)));
    }
}
