package dev.ojbk.console.kafka;

import dev.ojbk.config.ConfigPublisher;
import dev.ojbk.config.KafkaConfigPublisher;
import dev.ojbk.console.topic.DefaultTopicMessageOperations;
import dev.ojbk.console.topic.TopicMessageOperations;
import dev.ojbk.console.delay.DelayCancellationPublisher;
import dev.ojbk.console.delay.KafkaDelayCancellationPublisher;
import dev.ojbk.console.group.DefaultGroupOperations;
import dev.ojbk.console.group.GroupOperations;
import dev.ojbk.console.cluster.ClusterOperations;
import dev.ojbk.console.cluster.DefaultClusterOperations;
import java.util.Map;
import org.apache.kafka.clients.admin.Admin;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class KafkaConfiguration {

    @Bean(destroyMethod = "close")
    Admin kafkaAdmin(@Value("${ojbquay.kafka.bootstrap-servers}") String bootstrapServers) {
        return Admin.create(Map.of(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers));
    }

    @Bean
    KafkaAdminOperations kafkaAdminOperations(
            Admin admin,
            @Value("${ojbquay.kafka.internal-replication-factor:1}") short replicationFactor) {
        return new DefaultKafkaAdminOperations(admin, replicationFactor);
    }

    @Bean(destroyMethod = "close")
    ConfigPublisher configPublisher(
            @Value("${ojbquay.kafka.bootstrap-servers}") String bootstrapServers) {
        return new KafkaConfigPublisher(bootstrapServers);
    }

    @Bean(destroyMethod = "close")
    KafkaDlqOperations kafkaDlqOperations(
            @Value("${ojbquay.kafka.bootstrap-servers}") String bootstrapServers) {
        return new DefaultKafkaDlqOperations(bootstrapServers);
    }

    @Bean(destroyMethod = "close")
    TopicMessageOperations topicMessageOperations(
            @Value("${ojbquay.kafka.bootstrap-servers}") String bootstrapServers) {
        return new DefaultTopicMessageOperations(bootstrapServers);
    }

    @Bean(destroyMethod = "close")
    DelayCancellationPublisher delayCancellationPublisher(
            @Value("${ojbquay.kafka.bootstrap-servers}") String bootstrapServers) {
        return new KafkaDelayCancellationPublisher(bootstrapServers);
    }

    @Bean
    GroupOperations groupOperations(Admin admin) {
        return new DefaultGroupOperations(admin);
    }

    @Bean
    ClusterOperations clusterOperations(Admin admin) {
        return new DefaultClusterOperations(admin);
    }

    @Bean
    ApplicationRunner internalTopicInitializer(KafkaAdminOperations operations) {
        return arguments -> {
            if (operations instanceof DefaultKafkaAdminOperations kafka) {
                kafka.ensureConfigTopic();
                kafka.ensureDelayInbox();
            }
        };
    }
}
