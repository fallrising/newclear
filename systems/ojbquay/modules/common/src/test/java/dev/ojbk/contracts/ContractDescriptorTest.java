package dev.ojbk.contracts;

import static org.assertj.core.api.Assertions.assertThat;

import ojbk.v1.Consumer;
import ojbk.v1.MessageOut;
import ojbk.v1.Producer;
import org.junit.jupiter.api.Test;

final class ContractDescriptorTest {

    @Test
    void exposesStableProducerAndConsumerServices() {
        assertThat(Producer.getDescriptor().getServices())
                .extracting(service -> service.getFullName())
                .containsExactly("ojbk.v1.ProducerService");
        assertThat(Consumer.getDescriptor().getServices())
                .extracting(service -> service.getFullName())
                .containsExactly("ojbk.v1.ConsumerService");
        assertThat(MessageOut.getDescriptor().findFieldByName("code").getNumber())
                .isEqualTo(10);
    }
}
