package dev.ojbk.config;

import java.util.regex.Pattern;

public record TopicConfig(
        String name,
        long clusterId,
        int partitions,
        int replication,
        boolean delayTopic,
        int maxMessageBytes,
        long retentionMs,
        int produceQuotaTps,
        String token,
        String owner,
        boolean enabled) {

    public static final int HARD_MAX_MESSAGE_BYTES = 4_194_304;
    private static final Pattern NAME = Pattern.compile("[A-Za-z][A-Za-z0-9._-]{0,127}");
    private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{32}");

    public TopicConfig {
        if (name == null || !NAME.matcher(name).matches()) {
            throw new IllegalArgumentException(
                    "name must start with a letter and contain at most 128 safe characters");
        }
        if (clusterId < 1) {
            throw new IllegalArgumentException("clusterId must be positive");
        }
        if (partitions < 1 || partitions > 1_024) {
            throw new IllegalArgumentException("partitions must be between 1 and 1024");
        }
        if (replication < 1 || replication > 7) {
            throw new IllegalArgumentException("replication must be between 1 and 7");
        }
        if (maxMessageBytes < 1 || maxMessageBytes > HARD_MAX_MESSAGE_BYTES) {
            throw new IllegalArgumentException(
                    "maxMessageBytes must be between 1 and " + HARD_MAX_MESSAGE_BYTES);
        }
        if (retentionMs < 1) {
            throw new IllegalArgumentException("retentionMs must be positive");
        }
        if (produceQuotaTps < 1) {
            throw new IllegalArgumentException("produceQuotaTps must be positive");
        }
        if (token == null || !TOKEN.matcher(token).matches()) {
            throw new IllegalArgumentException("token must be exactly 32 lowercase hex characters");
        }
        if (owner == null || owner.isBlank()) {
            throw new IllegalArgumentException("owner must not be blank");
        }
    }
}
