package dev.ojbk.gateway.consume;

record PullRecordId(String topic, int partition, long offset) {
    PullRecordId {
        if (topic == null || topic.isBlank()) {
            throw new IllegalArgumentException("topic must not be blank");
        }
        if (partition < 0 || offset < 0) {
            throw new IllegalArgumentException(
                    "partition and offset must not be negative");
        }
    }

    static PullRecordId from(PushMessage message) {
        return new PullRecordId(
                message.topic(), message.partition(), message.offset());
    }

    static PullRecordId from(PullDelivery delivery) {
        return new PullRecordId(
                delivery.topic(), delivery.partition(), delivery.offset());
    }
}
