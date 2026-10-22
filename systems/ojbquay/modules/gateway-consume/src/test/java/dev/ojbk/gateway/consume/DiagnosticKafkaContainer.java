package dev.ojbk.gateway.consume;

import com.github.dockerjava.api.command.InspectContainerResponse;
import java.util.Objects;
import java.util.function.Consumer;
import org.testcontainers.kafka.KafkaContainer;

/** Retains only non-secret lifecycle evidence for synthetic test brokers. */
class DiagnosticKafkaContainer extends KafkaContainer {
    private final Consumer<String> diagnostics;

    DiagnosticKafkaContainer(String image, Consumer<String> diagnostics) {
        super(image);
        this.diagnostics = Objects.requireNonNull(diagnostics, "diagnostics");
    }

    @Override
    protected void containerIsStopping(InspectContainerResponse ignored) {
        // The hook argument is cached from startup; inspect again before stop() removes it.
        try {
            InspectContainerResponse current =
                    getDockerClient().inspectContainerCmd(getContainerId()).exec();
            var state = current.getState();
            emit("kafka_final_state id=" + current.getId()
                    + " image=" + current.getImageId()
                    + " status=" + state.getStatus()
                    + " running=" + state.getRunning()
                    + " dead=" + state.getDead()
                    + " oomKilled=" + state.getOOMKilled()
                    + " exitCode=" + state.getExitCodeLong()
                    + " startedAt=" + state.getStartedAt()
                    + " finishedAt=" + state.getFinishedAt());
        } catch (RuntimeException unavailable) {
            // Never mask the startup failure or prevent removal; error messages may contain config.
            emit("kafka_final_state=unavailable error_type="
                    + unavailable.getClass().getSimpleName());
        }
    }

    private void emit(String diagnostic) {
        try {
            diagnostics.accept(diagnostic);
        } catch (RuntimeException unavailable) {
            // A failed diagnostic sink must not block Testcontainers cleanup either.
        }
    }
}
