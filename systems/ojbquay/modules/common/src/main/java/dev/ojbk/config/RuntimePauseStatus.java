package dev.ojbk.config;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;

/** Current-process observation, not a requested-stop flag or cached metric. */
public record RuntimePauseStatus(String instanceId, String bootId, String rosterFingerprint,
        long subscriptionId, long revision, boolean paused, boolean fetchStopped,
        boolean inflightSettled, boolean bootstrapComplete) {
    private static final ObjectMapper JSON = new ObjectMapper();
    public String toJson() {
        try { return JSON.writeValueAsString(this); }
        catch (JsonProcessingException impossible) { throw new IllegalStateException(impossible); }
    }
    public static RuntimePauseStatus fromJson(String json) {
        try { return JSON.readValue(json, RuntimePauseStatus.class); }
        catch (JsonProcessingException invalid) { throw new IllegalArgumentException("invalid pause status", invalid); }
    }
}
