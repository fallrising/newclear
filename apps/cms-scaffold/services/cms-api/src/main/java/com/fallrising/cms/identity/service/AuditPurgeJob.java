package com.fallrising.cms.identity.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes expired audit events (surface-admin §7.2): first run one hour after startup, then 24 hours after each run
 * ends. Both are ISO-8601 durations and can be changed with cms.audit.purge-initial-delay and cms.audit.purge-interval.
 */
@Component
public class AuditPurgeJob {

    private static final Logger log = LoggerFactory.getLogger(AuditPurgeJob.class);

    private final AuditRetentionService retention;

    public AuditPurgeJob(AuditRetentionService retention) {
        this.retention = retention;
    }

    @Scheduled(initialDelayString = "${cms.audit.purge-initial-delay:PT1H}",
            fixedDelayString = "${cms.audit.purge-interval:PT24H}")
    public void run() {
        int deleted = retention.purgeExpired();
        log.info("Audit purge deleted {} events", deleted);
    }
}
