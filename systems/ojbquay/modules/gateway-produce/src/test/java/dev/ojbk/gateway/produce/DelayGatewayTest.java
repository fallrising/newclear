package dev.ojbk.gateway.produce;

import static org.assertj.core.api.Assertions.assertThat;

import ojbk.v1.Code;
import dev.ojbk.config.ConfigEntityType;
import dev.ojbk.config.ConfigEvent;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.delay.DelayAction;
import dev.ojbk.delay.DelayCommand;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class DelayGatewayTest {
    private static final Instant NOW = Instant.parse("2026-07-29T12:00:00Z");

    @Test
    void publishesFutureFiniteSeriesAfterLocalValidation() {
        Fixture fixture = fixture(true);

        DelayGatewayResult result = fixture.gateway.schedule(
                message(),
                token(),
                "delay-1",
                NOW.plusSeconds(60).toEpochMilli(),
                1_000L,
                3,
                NOW.plusSeconds(120).toEpochMilli());

        assertThat(result.code()).isEqualTo(Code.OK);
        assertThat(result.delayId()).isEqualTo("delay-1");
        assertThat(fixture.commands).singleElement().satisfies(command -> {
            assertThat(command.action()).isEqualTo(DelayAction.ADD);
            assertThat(command.loopRemaining()).isEqualTo(3);
            assertThat(command.headers()).containsEntry("traceparent", "00-test");
        });
        assertThat(fixture.broker.records).isEmpty();
    }

    @Test
    void sendsAlreadyDueOneShotDirectly() {
        Fixture fixture = fixture(true);

        DelayGatewayResult result = fixture.gateway.schedule(
                message(), token(), "", NOW.toEpochMilli(), null, null, null);

        assertThat(result.code()).isEqualTo(Code.OK);
        assertThat(result.delayId()).matches("[0-9a-f-]{36}");
        assertThat(fixture.commands).isEmpty();
        assertThat(fixture.broker.records)
                .singleElement()
                .satisfies(record -> assertThat(record.headers())
                        .containsEntry("x-ojbk-delay-id", result.delayId()));
    }

    @Test
    void rejectsNonDelayTopicAndOutOfRangeSchedule() {
        Fixture fixture = fixture(false);

        assertThat(fixture.gateway.schedule(
                                message(),
                                token(),
                                "delay-1",
                                NOW.plusSeconds(60).toEpochMilli(),
                                null,
                                null,
                                null)
                        .code())
                .isEqualTo(Code.INVALID_ARGUMENT);

        Fixture delayFixture = fixture(true);
        assertThat(delayFixture.gateway.schedule(
                                message(),
                                token(),
                                "delay-1",
                                NOW.plus(Duration.ofDays(31)).toEpochMilli(),
                                null,
                                null,
                                null)
                        .code())
                .isEqualTo(Code.INVALID_ARGUMENT);
        assertThat(delayFixture.commands).isEmpty();
    }

    @Test
    void publishesAuthenticatedCancelWithoutConsumingProduceQuota() {
        Fixture fixture = fixture(true);

        DelayGatewayResult first = fixture.gateway.cancel("orders", token(), "delay-1");
        DelayGatewayResult second = fixture.gateway.cancel("orders", token(), "delay-1");

        assertThat(first.code()).isEqualTo(Code.OK);
        assertThat(second.code()).isEqualTo(Code.OK);
        assertThat(fixture.commands)
                .extracting(DelayCommand::action)
                .containsExactly(DelayAction.CANCEL, DelayAction.CANCEL);
    }

    private static Fixture fixture(boolean delayTopic) {
        ConfigStore store = new ConfigStore();
        store.apply(new ConfigEvent(
                1,
                ConfigEntityType.TOPIC,
                "orders",
                1,
                NOW,
                "test",
                Map.ofEntries(
                        Map.entry("name", "orders"),
                        Map.entry("clusterId", 1),
                        Map.entry("partitions", 3),
                        Map.entry("replication", 1),
                        Map.entry("delayTopic", delayTopic),
                        Map.entry("maxMessageBytes", 1_024),
                        Map.entry("retentionMs", 259_200_000),
                        Map.entry("produceQuotaTps", 1),
                        Map.entry("token", token()),
                        Map.entry("owner", "alice"),
                        Map.entry("enabled", true))));
        RecordingBroker broker = new RecordingBroker();
        List<DelayCommand> commands = new ArrayList<>();
        ProducerEngine engine = new ProducerEngine(
                store,
                broker,
                Clock.fixed(NOW, ZoneOffset.UTC));
        DelayGateway gateway = new DelayGateway(
                engine,
                commands::add,
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ZERO);
        return new Fixture(gateway, broker, commands);
    }

    private static ProducerMessage message() {
        return new ProducerMessage(
                "orders",
                "order-1",
                "value".getBytes(java.nio.charset.StandardCharsets.UTF_8),
                List.of("paid"),
                Map.of("traceparent", "00-test"),
                1);
    }

    private static String token() {
        return "0123456789abcdef0123456789abcdef";
    }

    private record Fixture(
            DelayGateway gateway, RecordingBroker broker, List<DelayCommand> commands) {}

    private static final class RecordingBroker implements BrokerProducer {
        private final List<BrokerRecord> records = new ArrayList<>();

        @Override
        public BrokerAck send(BrokerRecord record) {
            records.add(record);
            return new BrokerAck(record.topic(), record.partition(), records.size() - 1L);
        }
    }
}
