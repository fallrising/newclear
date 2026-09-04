package com.example.deck.service;

import com.example.deck.repository.AbuseSignalRepository;
import java.time.Clock;
import java.time.Instant;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AbuseSignalRecorder {
    private static final long RETENTION_SECONDS = 30L * 24 * 60 * 60;

    private final AbuseSignalRepository repository;
    private final Clock clock;

    @Autowired
    public AbuseSignalRecorder(AbuseSignalRepository repository) {
        this(repository, Clock.systemUTC());
    }

    AbuseSignalRecorder(AbuseSignalRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordPostCreated(long actorAccountId, long postId, String ipHmac) {
        Instant createdAt = now();
        repository.insertPostCreated(
                actorAccountId, postId, ipHmac, createdAt, expiresAt(createdAt));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordReplyCreated(long actorAccountId, long replyId, String ipHmac) {
        Instant createdAt = now();
        repository.insertReplyCreated(
                actorAccountId, replyId, ipHmac, createdAt, expiresAt(createdAt));
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordReportCreated(long actorAccountId, long reportId, String ipHmac) {
        Instant createdAt = now();
        repository.insertReportCreated(
                actorAccountId, reportId, ipHmac, createdAt, expiresAt(createdAt));
    }

    private Instant now() {
        return Instant.ofEpochSecond(clock.instant().getEpochSecond());
    }

    private long expiresAt(Instant createdAt) {
        return Math.addExact(createdAt.getEpochSecond(), RETENTION_SECONDS);
    }
}
