package dev.ojbk.gateway.consume;

record PullBrokerRecord(PushMessage message) {
    PullBrokerRecord {
        java.util.Objects.requireNonNull(message, "message");
    }

    PullRecordId id() {
        return PullRecordId.from(message);
    }
}
