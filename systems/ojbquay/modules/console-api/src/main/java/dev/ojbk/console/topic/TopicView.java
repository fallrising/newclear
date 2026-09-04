package dev.ojbk.console.topic;

import java.time.Instant;

public record TopicView(
        long id,
        String name,
        long clusterId,
        int partitions,
        int replication,
        boolean delayTopic,
        int maxMessageBytes,
        long retentionMs,
        int produceQuotaTps,
        String compression,
        String token,
        String owner,
        short state,
        long version,
        String remark,
        Instant createdAt,
        Instant updatedAt) {}
