package dev.ojbk.console.group;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.Optional;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AlterConsumerGroupOffsetsResult;
import org.apache.kafka.clients.admin.ListConsumerGroupOffsetsResult;
import org.apache.kafka.clients.admin.ListOffsetsResult;
import org.apache.kafka.clients.admin.OffsetSpec;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.common.KafkaFuture;
import org.apache.kafka.common.TopicPartition;
import org.junit.jupiter.api.Test;

final class DefaultGroupOperationsAc09Test {
    private static final TopicPartition PARTITION = new TopicPartition("orders", 0);
    @Test void AC_09_alterAcknowledgementCannotHideReadbackMismatch() {
        Admin admin = admin(0, Map.of(PARTITION, new OffsetAndMetadata(7)));
        assertThatThrownBy(() -> new DefaultGroupOperations(admin).reset("group", "orders", 1, "OFFSET", 1))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("verification");
    }
    @Test void AC_09_missingReadbackPartitionCannotSucceed() {
        Admin admin = admin(0, Map.of());
        assertThatThrownBy(() -> new DefaultGroupOperations(admin).reset("group", "orders", 1, "OFFSET", 1))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("verification");
    }
    @Test void AC_09_returnsOffsetsOnlyAfterActualBrokerVerification() {
        Admin admin = admin(0, Map.of(PARTITION, new OffsetAndMetadata(1)));
        assertThat(new DefaultGroupOperations(admin).reset("group", "orders", 1, "OFFSET", 1).offsets())
                .containsExactly(new PartitionOffset(0, 1));
        var order = org.mockito.Mockito.inOrder(admin);
        order.verify(admin).alterConsumerGroupOffsets(eq("group"), anyMap());
        order.verify(admin).listConsumerGroupOffsets("group");
    }
    @Test void AC_09_offsetBelowRetainedBeginningCannotAlter() {
        Admin admin = admin(5, Map.of(PARTITION, new OffsetAndMetadata(1)));
        assertThatThrownBy(() -> new DefaultGroupOperations(admin).reset("group", "orders", 1, "OFFSET", 1))
                .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("retained range");
        verify(admin, never()).alterConsumerGroupOffsets(eq("group"), anyMap());
    }
    private static Admin admin(long earliest, Map<TopicPartition, OffsetAndMetadata> actual) {
        Admin admin = mock(Admin.class);
        when(admin.listOffsets(anyMap())).thenAnswer(invocation -> {
            Map<TopicPartition, OffsetSpec> request = invocation.getArgument(0);
            long offset = request.get(PARTITION).getClass().equals(OffsetSpec.earliest().getClass()) ? earliest : 10;
            ListOffsetsResult offsets = mock(ListOffsetsResult.class);
            when(offsets.all()).thenReturn(KafkaFuture.completedFuture(Map.of(PARTITION,
                    new ListOffsetsResult.ListOffsetsResultInfo(offset, 0, Optional.empty()))));
            return offsets;
        });
        AlterConsumerGroupOffsetsResult altered = mock(AlterConsumerGroupOffsetsResult.class);
        when(altered.all()).thenReturn(KafkaFuture.completedFuture(null));
        when(admin.alterConsumerGroupOffsets(eq("group"), anyMap())).thenReturn(altered);
        ListConsumerGroupOffsetsResult readback = mock(ListConsumerGroupOffsetsResult.class);
        when(readback.partitionsToOffsetAndMetadata()).thenReturn(KafkaFuture.completedFuture(actual));
        when(admin.listConsumerGroupOffsets("group")).thenReturn(readback);
        return admin;
    }
}
