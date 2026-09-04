package dev.ojbk.console.group;

import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class LagExporterController {
    private static final MediaType PROMETHEUS = MediaType.parseMediaType(
            "text/plain; version=0.0.4; charset=utf-8");

    private final JdbcClient jdbc;
    private final GroupOperations groups;

    LagExporterController(JdbcClient jdbc, GroupOperations groups) {
        this.jdbc = jdbc;
        this.groups = groups;
    }

    @GetMapping("/internal/v1/lag-exporter")
    ResponseEntity<String> scrape() {
        List<ClassicSubscription> subscriptions = jdbc.sql("""
                        SELECT g.name AS group_name, t.name AS topic_name,
                               t.partitions
                        FROM subscription s
                        JOIN consume_group g ON g.id = s.group_id
                        JOIN topic t ON t.id = s.topic_id
                        WHERE s.state = 1 AND g.state = 1 AND t.state = 1
                          AND s.spec->>'mode' = 'PUSH'
                          AND COALESCE((s.spec->>'ordered')::boolean, false)
                        ORDER BY g.name, t.name
                        """)
                .query((row, number) -> new ClassicSubscription(
                        row.getString("group_name"),
                        row.getString("topic_name"),
                        row.getInt("partitions")))
                .list();
        StringBuilder output = new StringBuilder(
                "# TYPE ojbk_consumer_lag gauge\n");
        int errors = 0;
        for (ClassicSubscription subscription : subscriptions) {
            try {
                groups.classicProgress(
                                subscription.group(),
                                subscription.topic(),
                                subscription.partitions())
                        .forEach(partition -> output.append(
                                        "ojbk_consumer_lag{group=\"")
                                .append(label(subscription.group()))
                                .append("\",topic=\"")
                                .append(label(subscription.topic()))
                                .append("\",partition=\"")
                                .append(partition.partition())
                                .append("\"} ")
                                .append(partition.lag())
                                .append('\n'));
            } catch (RuntimeException failure) {
                errors++;
            }
        }
        output.append("# TYPE ojbk_lag_exporter_errors gauge\n")
                .append("ojbk_lag_exporter_errors ")
                .append(errors)
                .append('\n');
        return ResponseEntity.ok()
                .contentType(PROMETHEUS)
                .body(output.toString());
    }

    private static String label(String value) {
        return value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n");
    }

    private record ClassicSubscription(
            String group, String topic, int partitions) {}
}
