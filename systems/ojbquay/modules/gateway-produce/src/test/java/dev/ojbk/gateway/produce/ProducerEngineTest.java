package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;

import ojbk.v1.Code;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ProducerEngineTest {

    @Test
    void rejectsUnknownTopicAndBadTokenBeforeBrokerIo() {
        RecordingBroker broker = new RecordingBroker();
        ConfigStore store = new ConfigStore();
        ProducerEngine engine = engine(store, broker);

        assertThat(engine.produce(message("unknown", 10), "token").code())
                .isEqualTo(Code.TOPIC_NOT_FOUND);
        applyTopic(store, 100, 1_024, true);
        assertThat(engine.produce(message("orders", 10), "wrong").code())
                .isEqualTo(Code.AUTH_FAILED);

        assertThat(broker.records).isEmpty();
    }

    @Test
    void rejectsExhaustedQuotaOversizeAndInvalidPartitionBeforeBrokerIo() {
        RecordingBroker quotaBroker = new RecordingBroker();
        ConfigStore quotaStore = new ConfigStore();
        applyTopic(quotaStore, 1, 1_024, true);
        ProducerEngine quotaEngine = engine(quotaStore, quotaBroker);

        assertThat(quotaEngine.produce(message("orders", 10), token()).code())
                .isEqualTo(Code.OK);
        assertThat(quotaEngine.produce(message("orders", 10), token()).code())
                .isEqualTo(Code.QUOTA_EXCEEDED);
        assertThat(quotaBroker.records).hasSize(1);

        RecordingBroker validationBroker = new RecordingBroker();
        ConfigStore validationStore = new ConfigStore();
        applyTopic(validationStore, 100, 4, true);
        ProducerEngine validationEngine = engine(validationStore, validationBroker);

        assertThat(validationEngine.produce(message("orders", 5), token()).code())
                .isEqualTo(Code.MSG_TOO_LARGE);
        ProducerMessage invalidPartition = new ProducerMessage(
                "orders",
                "key-1",
                new byte[] {1},
                List.of(),
                Map.of(),
                9);
        assertThat(validationEngine.produce(invalidPartition, token()).code())
                .isEqualTo(Code.INVALID_ARGUMENT);
        ProducerMessage oversizedKey = new ProducerMessage(
                "orders",
                "k".repeat(1_025),
                new byte[] {1},
                List.of(),
                Map.of(),
                null);
        assertThat(validationEngine.produce(oversizedKey, token()).code())
                .isEqualTo(Code.INVALID_ARGUMENT);
        assertThat(validationBroker.records).isEmpty();
    }

    @Test
    void sendsValidatedMessageAndReturnsBrokerAcknowledgement() {
        RecordingBroker broker = new RecordingBroker();
        ConfigStore store = new ConfigStore();
        applyTopic(store, 100, 1_024, true);
        ProducerEngine engine = engine(store, broker);
        ProducerMessage message = new ProducerMessage(
                "orders",
                "order-42",
                "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                List.of("paid"),
                Map.of("traceparent", "00-trace-parent"),
                2);

        ProducerResult result = engine.produce(message, token());

        assertThat(result.code()).isEqualTo(Code.OK);
        assertThat(result.ack())
                .isEqualTo(new BrokerAck("orders", 2, 41));
        assertThat(broker.records).singleElement().satisfies(record -> {
            assertThat(record.topic()).isEqualTo("orders");
            assertThat(record.key()).isEqualTo("order-42");
            assertThat(record.partition()).isEqualTo(2);
            assertThat(record.headers())
                    .containsEntry("traceparent", "00-trace-parent")
                    .containsEntry("x-ojbk-tags", "paid");
        });
    }

    @Test
    void treatsDisabledTopicAsUnavailable() {
        RecordingBroker broker = new RecordingBroker();
        ConfigStore store = new ConfigStore();
        applyTopic(store, 100, 1_024, false);

        assertThat(engine(store, broker).produce(message("orders", 1), token()).code())
                .isEqualTo(Code.TOPIC_NOT_FOUND);
        assertThat(broker.records).isEmpty();
    }

    @Test
    void mapsBrokerFailureToBusinessCode() {
        ConfigStore store = new ConfigStore();
        applyTopic(store, 100, 1_024, true);
        BrokerProducer unavailable = record -> {
            throw new IllegalStateException("Kafka unavailable");
        };

        ProducerResult result =
                new ProducerEngine(store, unavailable).produce(message("orders", 1), token());

        assertThat(result.code()).isEqualTo(Code.BROKER_UNAVAILABLE);
        assertThat(result.ack()).isNull();
    }

    private static ProducerEngine engine(ConfigStore store, RecordingBroker broker) {
        return new ProducerEngine(
                store,
                broker,
                Clock.fixed(Instant.parse("2026-07-29T12:00:00Z"), ZoneOffset.UTC));
    }

    private static ProducerMessage message(String topic, int valueSize) {
        return new ProducerMessage(
                topic, null, new byte[valueSize], List.of(), Map.of(), null);
    }

    private static void applyTopic(
            ConfigStore store, int quota, int maxMessageBytes, boolean enabled) {
        assertThat(store.apply(new ConfigEvent(
                        1,
                        ConfigEntityType.TOPIC,
                        "orders",
                        1,
                        Instant.parse("2026-07-29T12:00:00Z"),
                        "test",
                        Map.ofEntries(
                                Map.entry("name", "orders"),
                                Map.entry("clusterId", 1),
                                Map.entry("partitions", 3),
                                Map.entry("replication", 1),
                                Map.entry("delayTopic", false),
                                Map.entry("maxMessageBytes", maxMessageBytes),
                                Map.entry("retentionMs", 259_200_000),
                                Map.entry("produceQuotaTps", quota),
                                Map.entry("token", token()),
                                Map.entry("owner", "alice"),
                                Map.entry("enabled", enabled)))))
                .isEqualTo(ConfigStore.ApplyResult.APPLIED);
    }

    private static String token() {
        return "0123456789abcdef0123456789abcdef";
    }

    private static final class RecordingBroker implements BrokerProducer {
        private final List<BrokerRecord> records = new ArrayList<>();

        @Override
        public BrokerAck send(BrokerRecord record) {
            records.add(record);
            return new BrokerAck(record.topic(), record.partition() == null ? 0 : record.partition(), 41);
        }
    }
}
