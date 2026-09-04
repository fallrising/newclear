package dev.ojbk.console.group;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.ListOffsetsResult;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.common.GroupState;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.errors.GroupIdNotFoundException;

public final class DefaultGroupOperations implements GroupOperations {
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private final Admin admin;

    public DefaultGroupOperations(Admin admin) {
        this.admin = java.util.Objects.requireNonNull(admin, "admin");
    }

    @Override
    public List<PartitionProgress> classicProgress(
            String group, String topic, int partitions) {
        Map<TopicPartition, OffsetAndMetadata> committed = await(
                admin.listConsumerGroupOffsets(group)
                        .partitionsToOffsetAndMetadata(),
                "group offsets could not be read");
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> ends =
                offsets(topic, partitions, OffsetSpec.latest());
        List<PartitionProgress> result = new ArrayList<>(partitions);
        for (int partition = 0; partition < partitions; partition++) {
            TopicPartition id = new TopicPartition(topic, partition);
            OffsetAndMetadata metadata = committed.get(id);
            Long committedOffset =
                    metadata == null ? null : metadata.offset();
            long end = ends.get(id).offset();
            long lag = committedOffset == null
                    ? end
                    : Math.max(0, end - committedOffset);
            result.add(new PartitionProgress(
                    partition, committedOffset, end, lag, null));
        }
        return List.copyOf(result);
    }

    @Override
    public boolean awaitEmpty(String group, Duration timeout) {
        long deadline = System.nanoTime() + timeout.toNanos();
        while (System.nanoTime() < deadline) {
            try {
                var description = admin.describeConsumerGroups(List.of(group))
                        .describedGroups()
                        .get(group)
                        .get(
                                REQUEST_TIMEOUT.toMillis(),
                                TimeUnit.MILLISECONDS);
                if (description.groupState() == GroupState.EMPTY
                        || description.groupState()
                                == GroupState.DEAD) {
                    return true;
                }
            } catch (ExecutionException failure) {
                if (failure.getCause() instanceof GroupIdNotFoundException) {
                    return true;
                }
                throw new IllegalStateException(
                        "consumer group state could not be read",
                        failure.getCause());
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(
                        "consumer group wait was interrupted", interrupted);
            } catch (TimeoutException timeoutFailure) {
                throw new IllegalStateException(
                        "consumer group state timed out", timeoutFailure);
            }
            try {
                Thread.sleep(250);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(
                        "consumer group wait was interrupted", interrupted);
            }
        }
        return false;
    }

    @Override
    public GroupOffsetReset reset(
            String group,
            String topic,
            int partitions,
            String mode,
            long value) {
        OffsetSpec requested = switch (mode) {
            case "OFFSET" -> null;
            case "TIMESTAMP" -> OffsetSpec.forTimestamp(value);
            default -> throw new IllegalArgumentException(
                    "reset mode must be TIMESTAMP or OFFSET");
        };
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> ends =
                offsets(topic, partitions, OffsetSpec.latest());
        Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> byTime =
                requested == null
                        ? Map.of()
                        : offsets(topic, partitions, requested);
        Map<TopicPartition, OffsetAndMetadata> target =
                new LinkedHashMap<>();
        List<PartitionOffset> response = new ArrayList<>(partitions);
        for (int partition = 0; partition < partitions; partition++) {
            TopicPartition id = new TopicPartition(topic, partition);
            long end = ends.get(id).offset();
            long offset = requested == null
                    ? value
                    : byTime.get(id).offset() < 0
                            ? end
                            : byTime.get(id).offset();
            if (offset < 0 || offset > end) {
                throw new IllegalArgumentException(
                        "requested offset is outside the retained range");
            }
            target.put(id, new OffsetAndMetadata(offset));
            response.add(new PartitionOffset(partition, offset));
        }
        await(
                admin.alterConsumerGroupOffsets(group, target).all(),
                "consumer group offsets could not be reset");
        return new GroupOffsetReset(group, topic, response);
    }

    private Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> offsets(
            String topic, int partitions, OffsetSpec spec) {
        Map<TopicPartition, OffsetSpec> request =
                new LinkedHashMap<>();
        for (int partition = 0; partition < partitions; partition++) {
            request.put(new TopicPartition(topic, partition), spec);
        }
        return await(
                admin.listOffsets(request).all(),
                "topic offsets could not be read");
    }

    private static <T> T await(
            org.apache.kafka.common.KafkaFuture<T> future,
            String message) {
        try {
            return future.get(
                    REQUEST_TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(message, interrupted);
        } catch (ExecutionException failure) {
            throw new IllegalStateException(message, failure.getCause());
        } catch (TimeoutException timeout) {
            throw new IllegalStateException(message, timeout);
        }
    }
}
