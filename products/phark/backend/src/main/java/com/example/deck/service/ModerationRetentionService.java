package com.example.deck.service;

import com.example.deck.repository.AbuseRateLimitRepository;
import com.example.deck.repository.AbuseSignalRepository;
import com.example.deck.repository.ContentReportRepository;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModerationRetentionService {
    private final AbuseSignalRepository signalRepository;
    private final ContentReportRepository reportRepository;
    private final AbuseRateLimitRepository bucketRepository;
    private final Clock clock;

    @Autowired
    public ModerationRetentionService(
            AbuseSignalRepository signalRepository,
            ContentReportRepository reportRepository,
            AbuseRateLimitRepository bucketRepository) {
        this(signalRepository, reportRepository, bucketRepository, Clock.systemUTC());
    }

    ModerationRetentionService(
            AbuseSignalRepository signalRepository,
            ContentReportRepository reportRepository,
            AbuseRateLimitRepository bucketRepository,
            Clock clock) {
        this.signalRepository = signalRepository;
        this.reportRepository = reportRepository;
        this.bucketRepository = bucketRepository;
        this.clock = clock;
    }

    @Transactional
    public CleanupResult cleanupExpired() {
        long cutoffEpochSecond = clock.instant().getEpochSecond();
        int signalsDeleted = signalRepository.deleteExpired(cutoffEpochSecond);
        int reportsDeleted = reportRepository.deleteExpired(cutoffEpochSecond);
        int bucketsDeleted = bucketRepository.deleteExpired(cutoffEpochSecond);
        return new CleanupResult(signalsDeleted, reportsDeleted, bucketsDeleted);
    }

    public record CleanupResult(int signalsDeleted, int reportsDeleted, int bucketsDeleted) {}
}
