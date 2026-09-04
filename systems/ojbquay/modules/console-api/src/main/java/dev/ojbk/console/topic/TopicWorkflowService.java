package dev.ojbk.console.topic;

import dev.ojbk.console.audit.OperationAudit;
import dev.ojbk.console.security.Actor;
import dev.ojbk.console.security.ResourceAuthorization;
import dev.ojbk.messaging.MessageLimits;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
final class TopicWorkflowService {
    private static final Pattern HEADER =
            Pattern.compile("[!#$%&'*+.^_`|~0-9A-Za-z-]+");
    private static final Set<String> FORBIDDEN_HEADERS =
            Set.of("host", "content-length", "connection", "transfer-encoding");

    private final JdbcClient jdbc;
    private final ResourceAuthorization authorization;
    private final TopicMessageOperations messages;
    private final OperationAudit audit;

    TopicWorkflowService(
            JdbcClient jdbc,
            ResourceAuthorization authorization,
            TopicMessageOperations messages,
            OperationAudit audit) {
        this.jdbc = jdbc;
        this.authorization = authorization;
        this.messages = messages;
        this.audit = audit;
    }

    List<TopicSample> sample(
            long id,
            int maximum,
            boolean redact,
            String cel,
            Actor actor) {
        TopicRef topic = topic(id, actor);
        if (maximum < 1 || maximum > 100) {
            throw new IllegalArgumentException("n must be 1..100");
        }
        String expression = cel == null ? "" : cel;
        if (expression.length() > 2_048) {
            throw new IllegalArgumentException(
                    "CEL expression is too long");
        }
        return messages.sample(
                topic.name(),
                topic.partitions(),
                maximum,
                redact,
                expression);
    }

    TestMessageResult publish(
            long id, TestMessageRequest request, Actor actor) {
        TopicRef topic = topic(id, actor);
        PreparedTestMessage message = prepare(request, topic);
        TestMessageResult result = messages.publish(topic.name(), message);
        audit.record(
                actor.username(),
                "TOPIC_TEST_MESSAGE",
                "TOPIC",
                topic.name(),
                Map.of(
                        "partition", result.partition(),
                        "offset", result.offset(),
                        "valueBytes", message.value().length));
        return result;
    }

    private TopicRef topic(long id, Actor actor) {
        TopicRef topic = jdbc.sql("""
                        SELECT name, owner, partitions, max_message_bytes
                        FROM topic
                        WHERE id = :id AND state <> 9
                        """)
                .param("id", id)
                .query((row, number) -> new TopicRef(
                        row.getString("name"),
                        row.getString("owner"),
                        row.getInt("partitions"),
                        row.getInt("max_message_bytes")))
                .optional()
                .orElseThrow(() -> new dev.ojbk.console.api.ApiException(
                        "NOT_FOUND",
                        org.springframework.http.HttpStatus.NOT_FOUND,
                        "topic does not exist"));
        authorization.requireOwnerOrAdmin(topic.owner(), actor);
        return topic;
    }

    private static PreparedTestMessage prepare(
            TestMessageRequest request, TopicRef topic) {
        byte[] value;
        try {
            value = Base64.getDecoder().decode(request.valueBase64());
        } catch (IllegalArgumentException invalid) {
            throw new IllegalArgumentException(
                    "valueBase64 must be valid Base64", invalid);
        }
        if (value.length > topic.maxMessageBytes()
                || value.length > MessageLimits.MAX_VALUE_BYTES) {
            throw new IllegalArgumentException(
                    "test message exceeds the topic value limit");
        }
        if (request.partition() != null
                && (request.partition() < 0
                        || request.partition() >= topic.partitions())) {
            throw new IllegalArgumentException(
                    "partition is outside the topic range");
        }
        if (request.tags().size() > 64
                || request.tags().stream().anyMatch(
                        tag -> tag.isBlank() || tag.length() > 128)
                || new HashSet<>(request.tags()).size()
                        != request.tags().size()) {
            throw new IllegalArgumentException("tags are invalid");
        }
        if (request.headers().size() > 32) {
            throw new IllegalArgumentException("headers exceed 32 entries");
        }
        request.headers().forEach((key, headerValue) -> {
            if (!HEADER.matcher(key).matches()
                    || FORBIDDEN_HEADERS.contains(
                            key.toLowerCase(java.util.Locale.ROOT))
                    || "x-ojbk-tags".equalsIgnoreCase(key)
                    || headerValue == null
                    || headerValue.isEmpty()
                    || headerValue.length() > 8_192
                    || headerValue.indexOf('\r') >= 0
                    || headerValue.indexOf('\n') >= 0) {
                throw new IllegalArgumentException(
                        "headers contain an unsafe entry");
            }
        });
        return new PreparedTestMessage(
                request.key(),
                value,
                request.tags(),
                request.headers(),
                request.partition());
    }

    private record TopicRef(
            String name, String owner, int partitions, int maxMessageBytes) {}
}
