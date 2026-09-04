package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.example.deck.dto.CreateContentReportRequest;
import com.example.deck.error.ApiException;
import com.example.deck.model.Account;
import com.example.deck.model.ContentReport;
import com.example.deck.model.ContentReportReason;
import com.example.deck.model.ContentReportStatus;
import com.example.deck.model.ContentReportTargetType;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.ContentReportRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.UncategorizedSQLException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ContentReportServiceTest {
    private static final Instant NOW = Instant.parse("2026-01-02T03:04:05.987Z");

    @Autowired AccountRepository accounts;
    @Autowired PostRepository realPosts;
    @Autowired ReplyRepository realReplies;
    @Autowired ContentReportRepository realReports;
    @Autowired JdbcClient jdbc;

    @Test
    void persistsTheSingleSecondsPrecisionClockInstantAndExact180DayExpiry() {
        ContentReportRepository reports = mock(ContentReportRepository.class);
        PostRepository posts = mock(PostRepository.class);
        when(posts.existsById(22L)).thenReturn(true);
        ContentReport expected = report(7L, ContentReportTargetType.POST, 22L, ContentReportReason.SPAM,
                NOW.truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        AbuseSignalRecorder signals = mock(AbuseSignalRecorder.class);
        when(reports.insert(eq(11L), eq(ContentReportTargetType.POST), eq(22L), eq(ContentReportReason.SPAM),
                any(Instant.class), eq(NOW.getEpochSecond() + 180L * 24 * 60 * 60))).thenReturn(expected);

        ContentReportService service = new ContentReportService(
                reports, posts, mock(ReplyRepository.class), signals, Clock.fixed(NOW, ZoneOffset.UTC));

        assertThat(service.reportPost(22L, 11L,
                new CreateContentReportRequest(ContentReportReason.SPAM), "a".repeat(64)))
                .isEqualTo(expected);
        ArgumentCaptor<Instant> createdAt = ArgumentCaptor.forClass(Instant.class);
        verify(reports).insert(eq(11L), eq(ContentReportTargetType.POST), eq(22L), eq(ContentReportReason.SPAM),
                createdAt.capture(), eq(NOW.getEpochSecond() + 180L * 24 * 60 * 60));
        assertThat(createdAt.getValue()).isEqualTo(Instant.parse("2026-01-02T03:04:05Z"));
        verify(signals).recordReportCreated(11L, 7L, "a".repeat(64));
    }

    @Test
    void mapsOnlySqliteUniqueConstraintRacesToDuplicateReport() {
        ContentReportRepository reports = mock(ContentReportRepository.class);
        PostRepository posts = mock(PostRepository.class);
        when(posts.existsById(22L)).thenReturn(true);
        when(reports.insert(any(Long.class), any(ContentReportTargetType.class), any(Long.class),
                any(ContentReportReason.class), any(Instant.class), any(Long.class)))
                .thenThrow(new UncategorizedSQLException("insert", "insert", sqlite(
                        org.sqlite.SQLiteErrorCode.SQLITE_CONSTRAINT_UNIQUE)));
        ContentReportService service = new ContentReportService(reports, posts, mock(ReplyRepository.class),
                mock(AbuseSignalRecorder.class), Clock.fixed(NOW, ZoneOffset.UTC));

        assertThatThrownBy(() -> service.reportPost(22L, 11L,
                new CreateContentReportRequest(ContentReportReason.SPAM), "a".repeat(64)))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getCode())
                .isEqualTo(com.example.deck.error.ApiErrorCode.DUPLICATE_REPORT);
    }

    @Test
    void preservesUnrelatedSqliteConstraintFailures() {
        ContentReportRepository reports = mock(ContentReportRepository.class);
        PostRepository posts = mock(PostRepository.class);
        when(posts.existsById(22L)).thenReturn(true);
        UncategorizedSQLException failure = new UncategorizedSQLException("insert", "insert", sqlite(
                org.sqlite.SQLiteErrorCode.SQLITE_CONSTRAINT_FOREIGNKEY));
        when(reports.insert(any(Long.class), any(ContentReportTargetType.class), any(Long.class),
                any(ContentReportReason.class), any(Instant.class), any(Long.class))).thenThrow(failure);
        ContentReportService service = new ContentReportService(reports, posts, mock(ReplyRepository.class),
                mock(AbuseSignalRecorder.class), Clock.fixed(NOW, ZoneOffset.UTC));

        assertThatThrownBy(() -> service.reportPost(22L, 11L,
                new CreateContentReportRequest(ContentReportReason.SPAM), "a".repeat(64)))
                .isSameAs(failure);
    }

    @Test
    void fixedClockPreservesLiveRowsAndReplacesOnlyTheExpiredReporterTarget() {
        Account firstReporter = accounts.insert("fixedfirst", "First", "hash");
        Account secondReporter = accounts.insert("fixedsecond", "Second", "hash");
        Post firstPost = realPosts.insert("Author", "First", "home");
        Post secondPost = realPosts.insert("Author", "Second", "home");
        Reply reply = realReplies.insert(firstPost.id(), "Author", "Reply");
        Instant createdAt = NOW.truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
        ContentReportService initial = serviceAt(createdAt);

        ContentReport original = initial.reportPost(firstPost.id(), firstReporter.id(),
                new CreateContentReportRequest(ContentReportReason.SPAM), "a".repeat(64));
        String originalRow = storedRow(original.id());
        assertThat(expiry(original.id())).isEqualTo(createdAt.plus(180, java.time.temporal.ChronoUnit.DAYS)
                .getEpochSecond());

        ContentReportService stillLive = serviceAt(createdAt.plus(180, java.time.temporal.ChronoUnit.DAYS)
                .minusSeconds(1));
        assertThatThrownBy(() -> stillLive.reportPost(firstPost.id(), firstReporter.id(),
                new CreateContentReportRequest(ContentReportReason.OTHER), "a".repeat(64)))
                .isInstanceOf(ApiException.class)
                .extracting(exception -> ((ApiException) exception).getCode())
                .isEqualTo(com.example.deck.error.ApiErrorCode.DUPLICATE_REPORT);
        assertThat(storedRow(original.id())).isEqualTo(originalRow);

        Instant expiryBoundary = createdAt.plus(180, java.time.temporal.ChronoUnit.DAYS);
        ContentReport replacement = serviceAt(expiryBoundary).reportPost(firstPost.id(), firstReporter.id(),
                new CreateContentReportRequest(ContentReportReason.OTHER), "a".repeat(64));
        assertThat(replacement.id()).isNotEqualTo(original.id());
        assertThat(replacement.reason()).isEqualTo(ContentReportReason.OTHER);
        assertThat(replacement.createdAt()).isEqualTo(expiryBoundary);
        assertThat(realReports.findById(original.id())).isEmpty();

        initial.reportPost(firstPost.id(), secondReporter.id(),
                new CreateContentReportRequest(ContentReportReason.HARASSMENT), "b".repeat(64));
        initial.reportPost(secondPost.id(), firstReporter.id(),
                new CreateContentReportRequest(ContentReportReason.HATE_OR_VIOLENCE), "a".repeat(64));
        initial.reportReply(reply.id(), firstReporter.id(),
                new CreateContentReportRequest(ContentReportReason.SEXUAL_CONTENT), "a".repeat(64));
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports").query(Long.class).single()).isEqualTo(4);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports WHERE post_id = :id")
                .param("id", firstPost.id()).query(Long.class).single()).isEqualTo(2);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports WHERE reply_id = :id")
                .param("id", reply.id()).query(Long.class).single()).isEqualTo(1);
    }

    private ContentReportService serviceAt(Instant instant) {
        return new ContentReportService(realReports, realPosts, realReplies,
                mock(AbuseSignalRecorder.class), Clock.fixed(instant, ZoneOffset.UTC));
    }

    private long expiry(long reportId) {
        return jdbc.sql("SELECT expires_at_epoch FROM content_reports WHERE id = :id")
                .param("id", reportId).query(Long.class).single();
    }

    private String storedRow(long reportId) {
        return jdbc.sql("""
                        SELECT reporter_account_id, target_type, post_id, reply_id,
                               reason, status, created_at, expires_at_epoch
                        FROM content_reports WHERE id = :id""")
                .param("id", reportId)
                .query((rs, row) -> rs.getLong("reporter_account_id") + "|"
                        + rs.getString("target_type") + "|" + rs.getObject("post_id") + "|"
                        + rs.getObject("reply_id") + "|" + rs.getString("reason") + "|"
                        + rs.getString("status") + "|" + rs.getString("created_at") + "|"
                        + rs.getLong("expires_at_epoch"))
                .single();
    }

    private static ContentReport report(long id, ContentReportTargetType type, long targetId,
                                        ContentReportReason reason, Instant createdAt) {
        return new ContentReport(id, type, targetId, reason, ContentReportStatus.RECEIVED, createdAt);
    }

    private static org.sqlite.SQLiteException sqlite(org.sqlite.SQLiteErrorCode errorCode) {
        return new org.sqlite.SQLiteException(errorCode + "", errorCode);
    }
}
