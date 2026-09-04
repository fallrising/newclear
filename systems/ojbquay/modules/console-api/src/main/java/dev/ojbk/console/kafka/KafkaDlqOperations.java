package dev.ojbk.console.kafka;

import dev.ojbk.console.dlq.DlqRecordRef;
import dev.ojbk.console.dlq.DlqRecordView;
import java.util.List;

public interface KafkaDlqOperations extends AutoCloseable {
    List<DlqRecordView> readTail(String dlqTopic, int limit);

    void replay(String dlqTopic, String sourceTopic, List<DlqRecordRef> records);

    @Override
    void close();
}
