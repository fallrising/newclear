package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;

class ModerationRetentionSchedulerTest {
    @Test
    void startupAndDailyTriggersDelegateWithoutSensitiveInputs() throws Exception {
        ModerationRetentionService service = mock(ModerationRetentionService.class);
        when(service.cleanupExpired()).thenReturn(
                new ModerationRetentionService.CleanupResult(1, 2, 3));
        ModerationRetentionScheduler scheduler = new ModerationRetentionScheduler(service);

        scheduler.cleanupAtStartup();
        scheduler.cleanupDaily();

        verify(service, times(2)).cleanupExpired();
        Method startup = ModerationRetentionScheduler.class.getDeclaredMethod("cleanupAtStartup");
        assertThat(startup.getAnnotation(EventListener.class).classes())
                .containsExactly(org.springframework.boot.context.event.ApplicationReadyEvent.class);
        Scheduled scheduled = ModerationRetentionScheduler.class
                .getDeclaredMethod("cleanupDaily").getAnnotation(Scheduled.class);
        assertThat(scheduled.cron()).isEqualTo("0 0 3 * * *");
        assertThat(scheduled.zone()).isEqualTo("UTC");
    }
}
