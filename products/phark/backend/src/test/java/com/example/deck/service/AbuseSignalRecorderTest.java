package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AbuseSignalRepository;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
class AbuseSignalRecorderTest {
    private static final long RETENTION_SECONDS = 30L * 24 * 60 * 60;

    @Autowired
    private AbuseSignalRecorder recorder;

    @Autowired
    private AccountRepository accounts;

    @Autowired
    private PostRepository posts;

    @Autowired
    private ReplyRepository replies;

    @Autowired
    private JdbcClient jdbc;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @BeforeEach
    void cleanSignals() {
        jdbc.sql("DELETE FROM abuse_signals").update();
        jdbc.sql("DELETE FROM content_reports").update();
    }

    @Test
    void rejectsUseOutsideCallerTransaction() {
        Account actor = account("rec_no_tx");
        Post post = posts.insertOwned(actor.id(), "content", "home");

        assertThatThrownBy(() -> recorder.recordPostCreated(
                actor.id(), post.id(), "a".repeat(64)))
                .isInstanceOf(IllegalTransactionStateException.class);
        assertThat(countSignals()).isZero();
    }

    @Test
    void recordsAllActionsInsideRealTransactionWithExactRetention() {
        Account actor = account("rec_actions");
        Post post = posts.insertOwned(actor.id(), "content", "home");
        Reply reply = replies.insertOwned(post.id(), actor.id(), "reply");
        long reportId = insertReport(actor.id(), post.id());
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        transaction.executeWithoutResult(status -> {
            recorder.recordPostCreated(actor.id(), post.id(), "a".repeat(64));
            recorder.recordReplyCreated(actor.id(), reply.id(), "b".repeat(64));
            recorder.recordReportCreated(actor.id(), reportId, "c".repeat(64));
        });

        assertThat(jdbc.sql("SELECT action_kind FROM abuse_signals ORDER BY id")
                .query(String.class).list())
                .containsExactly("POST_CREATED", "REPLY_CREATED", "REPORT_CREATED");
        assertThat(jdbc.sql("""
                SELECT expires_at_epoch - CAST(strftime('%s', created_at) AS INTEGER)
                FROM abuse_signals""").query(Long.class).list())
                .containsOnly(RETENTION_SECONDS);
    }

    @Test
    void participatesInRollbackOfCallerTransaction() {
        Account actor = account("rec_rollback");
        Post post = posts.insertOwned(actor.id(), "content", "home");
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            recorder.recordPostCreated(actor.id(), post.id(), "a".repeat(64));
            throw new IllegalStateException("force rollback");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(countSignals()).isZero();
    }

    @Test
    void fixedClockIsSampledOnceAndDefinesCreatedAndExpiry() {
        AbuseSignalRepository repository = mock(AbuseSignalRepository.class);
        Instant fixed = Instant.parse("2026-09-04T12:34:56.987654Z");
        AbuseSignalRecorder fixedRecorder = new AbuseSignalRecorder(
                repository, Clock.fixed(fixed, ZoneOffset.UTC));

        fixedRecorder.recordReplyCreated(7, 11, "a".repeat(64));

        Instant seconds = Instant.ofEpochSecond(fixed.getEpochSecond());
        verify(repository).insertReplyCreated(
                7, 11, "a".repeat(64), seconds,
                seconds.getEpochSecond() + RETENTION_SECONDS);
    }

    private Account account(String handle) {
        return accounts.insert(handle, handle, "hash");
    }

    private long insertReport(long reporterId, long postId) {
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.sql("""
                INSERT INTO content_reports
                    (reporter_account_id, target_type, post_id, reason, status, expires_at_epoch)
                VALUES (:reporterId, 'POST', :postId, 'SPAM', 'RECEIVED', 2000000000)""")
                .param("reporterId", reporterId)
                .param("postId", postId)
                .update(keys);
        Number key = keys.getKey();
        if (key == null) {
            throw new IllegalStateException("Missing report id");
        }
        return key.longValue();
    }

    private long countSignals() {
        return jdbc.sql("SELECT COUNT(*) FROM abuse_signals").query(Long.class).single();
    }
}
