package dev.ojbk.gateway.produce;

public interface BrokerProducer extends AutoCloseable {
    BrokerAck send(BrokerRecord record);

    @Override
    default void close() {}
}
