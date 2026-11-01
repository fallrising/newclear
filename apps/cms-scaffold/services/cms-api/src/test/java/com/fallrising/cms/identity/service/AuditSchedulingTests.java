package com.fallrising.cms.identity.service;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.scheduling.config.FixedDelayTask;
import org.springframework.scheduling.config.ScheduledTaskHolder;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

/** The registered job honors duration overrides; invoking the job performs one retention purge. */
@SpringBootTest(properties = {"cms.audit.purge-initial-delay=PT2H", "cms.audit.purge-interval=PT48H"})
class AuditSchedulingTests {

    @Autowired
    ScheduledTaskHolder scheduledTasks;

    @Test
    void BW4_configuredDurationsOverrideTheRegisteredFixedDelay() {
        List<FixedDelayTask> purge = scheduledTasks.getScheduledTasks().stream()
                .map(task -> task.getTask())
                .filter(task -> task instanceof FixedDelayTask)
                .map(task -> (FixedDelayTask) task)
                .filter(task -> task.getRunnable().toString().equals(AuditPurgeJob.class.getName() + ".run"))
                .toList();
        assertThat(purge).hasSize(1);
        assertThat(purge.getFirst().getInitialDelayDuration()).isEqualTo(Duration.ofHours(2));
        assertThat(purge.getFirst().getIntervalDuration()).isEqualTo(Duration.ofHours(48));
    }

    @Test
    void BW4_jobRunsOnePurge() {
        AuditRetentionService retention = mock(AuditRetentionService.class);
        when(retention.purgeExpired()).thenReturn(3);
        new AuditPurgeJob(retention).run();
        verify(retention).purgeExpired();
        verifyNoMoreInteractions(retention);
    }
}
