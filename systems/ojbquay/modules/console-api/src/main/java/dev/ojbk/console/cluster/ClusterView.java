package dev.ojbk.console.cluster;

import java.time.Instant;

public record ClusterView(
        long id,
        String name,
        String bootstrapServers,
        boolean defaultCluster,
        Instant createdAt) {}
