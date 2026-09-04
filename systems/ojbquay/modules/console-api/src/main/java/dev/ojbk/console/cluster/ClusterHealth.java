package dev.ojbk.console.cluster;

public record ClusterHealth(
        String clusterId, int controllerId, int nodeCount, String status) {}
