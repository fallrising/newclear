package dev.ojbk.gateway.consume;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.github.dockerjava.api.exception.NotFoundException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.ContainerLaunchException;
import org.testcontainers.containers.wait.strategy.Wait;

final class DiagnosticKafkaContainerTest {
    @Test
    void retainsExitedBrokerStateBeforeStartupFailureCleanup() {
        List<String> diagnostics = new ArrayList<>();
        try (DiagnosticKafkaContainer broker =
                new DiagnosticKafkaContainer("apache/kafka:4.2.0", diagnostics::add)) {
            // KafkaContainer shares its default strategy across instances. Give this
            // deliberately failing fixture its own wait, preserving every real broker gate.
            broker.withEnv("KAFKA_NODE_ID", "synthetic-invalid-integer")
                    .waitingFor(Wait.forLogMessage(".*SYNTHETIC_READY_NEVER.*", 1)
                            .withStartupTimeout(Duration.ofSeconds(5)));

            assertThatThrownBy(broker::start).isInstanceOf(ContainerLaunchException.class);

            assertThat(diagnostics).singleElement().asString()
                    .contains("kafka_final_state", "status=exited", "running=false", "exitCode=1");
            String id = diagnostics.getFirst().split("id=", 2)[1].split(" ", 2)[0];
            assertThatThrownBy(() -> broker.getDockerClient().inspectContainerCmd(id).exec())
                    .isInstanceOf(NotFoundException.class);
        }
    }
}
