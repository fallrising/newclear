package dev.ojbk.gateway.produce;

import ojbk.v1.Code;
import dev.ojbk.config.ConfigStore;
import dev.ojbk.config.TopicConfig;
import dev.ojbk.messaging.MessageLimits;
import dev.ojbk.security.TokenAuth;
import java.time.Clock;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class ProducerEngine {
    private static final int MAX_HEADERS = 64;
    private static final int MAX_HEADER_KEY_CHARS = 128;
    private static final int MAX_HEADER_VALUE_CHARS = 8_192;
    private static final int MAX_TAGS = 64;

    private final ConfigStore config;
    private final BrokerProducer broker;
    private final Clock clock;
    private final ProducerMetrics metrics;
    private final TopicQuota quota = new TopicQuota();

    public ProducerEngine(ConfigStore config, BrokerProducer broker) {
        this(config, broker, new ProducerMetrics());
    }

    public ProducerEngine(
            ConfigStore config, BrokerProducer broker, ProducerMetrics metrics) {
        this(config, broker, Clock.systemUTC(), metrics);
    }

    ProducerEngine(ConfigStore config, BrokerProducer broker, Clock clock) {
        this(config, broker, clock, new ProducerMetrics());
    }

    ProducerEngine(
            ConfigStore config, BrokerProducer broker, Clock clock, ProducerMetrics metrics) {
        this.config = Objects.requireNonNull(config, "config");
        this.broker = Objects.requireNonNull(broker, "broker");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.metrics = Objects.requireNonNull(metrics, "metrics");
    }

    public ProducerResult produce(ProducerMessage message, String token) {
        long startedAt = System.nanoTime();
        String metricTopic = message == null ? null : message.topic();
        int valueBytes = message == null || message.value() == null ? 0 : message.value().length;
        Validation validation = validate(message, token, true);
        if (validation.error() != null) {
            return measured(metricTopic, valueBytes, startedAt, validation.error());
        }
        return dispatch(validation, metricTopic, valueBytes, startedAt);
    }

    Validation validate(ProducerMessage message, String token, boolean consumeQuota) {
        String validation = validateEnvelope(message);
        if (validation != null) {
            return Validation.error(ProducerResult.error(Code.INVALID_ARGUMENT, validation));
        }
        TopicConfig topic = config.topic(message.topic()).orElse(null);
        if (topic == null || !topic.enabled()) {
            return Validation.error(
                    ProducerResult.error(Code.TOPIC_NOT_FOUND, "topic is not enabled"));
        }
        if (!TokenAuth.matches(topic.token(), token)) {
            return Validation.error(
                    ProducerResult.error(Code.AUTH_FAILED, "topic token is invalid"));
        }
        if (consumeQuota
                && !quota.tryConsume(topic.name(), topic.produceQuotaTps(), clock.millis())) {
            return Validation.error(
                    ProducerResult.error(Code.QUOTA_EXCEEDED, "topic quota is exhausted"));
        }
        if (message.value().length > topic.maxMessageBytes()) {
            return Validation.error(ProducerResult.error(
                    Code.MSG_TOO_LARGE, "message exceeds the topic limit"));
        }
        if (message.partition() != null
                && (message.partition() < 0 || message.partition() >= topic.partitions())) {
            return Validation.error(ProducerResult.error(
                    Code.INVALID_ARGUMENT, "partition is outside topic range"));
        }

        Map<String, String> headers = new HashMap<>(message.headers());
        if (!message.tags().isEmpty()) {
            headers.put("x-ojbk-tags", String.join(",", message.tags()));
        }
        return Validation.ok(
                topic,
                new BrokerRecord(
                        message.topic(),
                        message.partition(),
                        message.key(),
                        message.value(),
                        headers));
    }

    private ProducerResult dispatch(
            Validation validation, String topic, int valueBytes, long startedAt) {
        try {
            return measured(
                    topic,
                    valueBytes,
                    startedAt,
                    ProducerResult.ok(broker.send(validation.record())));
        } catch (RuntimeException failure) {
            return measured(
                    topic,
                    valueBytes,
                    startedAt,
                    ProducerResult.error(Code.BROKER_UNAVAILABLE, "broker send failed"));
        }
    }

    ProducerResult dispatchValidated(Validation validation) {
        if (validation.error() != null) {
            return validation.error();
        }
        return dispatch(
                validation,
                validation.record().topic(),
                validation.record().value().length,
                System.nanoTime());
    }

    private ProducerResult measured(
            String topic, int valueBytes, long startedAt, ProducerResult result) {
        metrics.record(topic, result.code(), valueBytes, System.nanoTime() - startedAt);
        return result;
    }

    private static String validateEnvelope(ProducerMessage message) {
        if (message == null) {
            return "message is required";
        }
        if (message.topic() == null || message.topic().isBlank()) {
            return "topic is required";
        }
        if (message.key() != null && message.key().length() > MessageLimits.MAX_KEY_CHARS) {
            return "key exceeds the supported limit";
        }
        if (message.value() == null) {
            return "value is required";
        }
        if (message.tags() == null || message.tags().size() > MAX_TAGS) {
            return "tags exceed the supported limit";
        }
        for (String tag : message.tags()) {
            if (tag == null || tag.isBlank() || tag.length() > 128 || tag.contains(",")) {
                return "tag is invalid";
            }
        }
        if (message.headers() == null || message.headers().size() > MAX_HEADERS) {
            return "headers exceed the supported limit";
        }
        for (Map.Entry<String, String> header : message.headers().entrySet()) {
            if (header.getKey() == null
                    || header.getKey().isBlank()
                    || header.getKey().length() > MAX_HEADER_KEY_CHARS
                    || header.getValue() == null
                    || header.getValue().length() > MAX_HEADER_VALUE_CHARS) {
                return "header is invalid";
            }
        }
        return null;
    }

    record Validation(TopicConfig topic, BrokerRecord record, ProducerResult error) {
        private static Validation ok(TopicConfig topic, BrokerRecord record) {
            return new Validation(topic, record, null);
        }

        private static Validation error(ProducerResult error) {
            return new Validation(null, null, error);
        }

        Validation withHeader(String name, String value) {
            if (error != null) {
                return this;
            }
            Map<String, String> headers = new HashMap<>(record.headers());
            headers.put(name, value);
            return new Validation(
                    topic,
                    new BrokerRecord(
                            record.topic(),
                            record.partition(),
                            record.key(),
                            record.value(),
                            headers),
                    null);
        }
    }
}
