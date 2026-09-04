package com.example.deck.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class ModerationRetentionScheduler {
    private static final Logger log = LoggerFactory.getLogger(ModerationRetentionScheduler.class);

    private final ModerationRetentionService retentionService;

    public ModerationRetentionScheduler(ModerationRetentionService retentionService) {
        this.retentionService = retentionService;
    }

    @EventListener(classes = ApplicationReadyEvent.class)
    void cleanupAtStartup() {
        cleanup("startup");
    }

    @Scheduled(cron = "0 0 3 * * *", zone = "UTC")
    void cleanupDaily() {
        cleanup("daily");
    }

    private void cleanup(String trigger) {
        ModerationRetentionService.CleanupResult result = retentionService.cleanupExpired();
        log.info(
                "Moderation retention cleanup completed: trigger={}, signalsDeleted={}, "
                        + "reportsDeleted={}, rateBucketsDeleted={}",
                trigger, result.signalsDeleted(), result.reportsDeleted(), result.bucketsDeleted());
    }
}
