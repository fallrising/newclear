package dev.ojbk.console.cluster;

import java.time.Duration;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.apache.kafka.clients.admin.Admin;

public final class DefaultClusterOperations implements ClusterOperations {
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private final Admin admin;

    public DefaultClusterOperations(Admin admin) {
        this.admin = java.util.Objects.requireNonNull(admin, "admin");
    }

    @Override
    public ClusterHealth health() {
        var result = admin.describeCluster();
        try {
            String clusterId = result.clusterId()
                    .get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            var controller = result.controller()
                    .get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
            int nodes = result.nodes()
                    .get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS)
                    .size();
            return new ClusterHealth(
                    clusterId,
                    controller == null ? -1 : controller.id(),
                    nodes,
                    nodes > 0 ? "UP" : "DOWN");
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(
                    "cluster health was interrupted", interrupted);
        } catch (ExecutionException | TimeoutException failure) {
            throw new IllegalStateException(
                    "cluster health is unavailable", failure);
        }
    }
}
