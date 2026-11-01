package com.fallrising.cms.platform;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** Turns on @Scheduled methods (BW4: AuditPurgeJob). */
@Configuration
@EnableScheduling
public class SchedulingConfig {}
