package com.example.deck.service;

import com.example.deck.dto.CreateContentReportRequest;
import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.ContentReport;
import com.example.deck.model.ContentReportTargetType;
import com.example.deck.repository.ContentReportRepository;
import com.example.deck.repository.PostRepository;
import com.example.deck.repository.ReplyRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.sqlite.SQLiteErrorCode;
import org.sqlite.SQLiteException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ContentReportService {
    private static final long RETENTION_SECONDS = 180L * 24 * 60 * 60;
    private final ContentReportRepository reportRepository;
    private final PostRepository postRepository;
    private final ReplyRepository replyRepository;
    private final AbuseSignalRecorder signalRecorder;
    private final Clock clock;

    @Autowired
    public ContentReportService(ContentReportRepository reportRepository, PostRepository postRepository,
                                ReplyRepository replyRepository, AbuseSignalRecorder signalRecorder) {
        this(reportRepository, postRepository, replyRepository, signalRecorder, Clock.systemUTC());
    }

    ContentReportService(ContentReportRepository reportRepository, PostRepository postRepository,
                         ReplyRepository replyRepository, AbuseSignalRecorder signalRecorder, Clock clock) {
        this.reportRepository = reportRepository;
        this.postRepository = postRepository;
        this.replyRepository = replyRepository;
        this.signalRecorder = signalRecorder;
        this.clock = clock;
    }

    @Transactional
    public ContentReport reportPost(
            long postId, long reporterId, CreateContentReportRequest request, String ipHmac) {
        Instant createdAt = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        long now = createdAt.getEpochSecond();
        if (postId <= 0) throw new ApiException(ApiErrorCode.INVALID_POST_ID);
        if (!postRepository.existsById(postId)) throw new ApiException(ApiErrorCode.POST_NOT_FOUND);
        reportRepository.deleteExpiredPostReport(reporterId, postId, now);
        if (reportRepository.hasLivePostReport(reporterId, postId, now)) throw new ApiException(ApiErrorCode.DUPLICATE_REPORT);
        ContentReport report = insert(
                reporterId, ContentReportTargetType.POST, postId, request, createdAt);
        signalRecorder.recordReportCreated(reporterId, report.id(), ipHmac);
        return report;
    }

    @Transactional
    public ContentReport reportReply(
            long replyId, long reporterId, CreateContentReportRequest request, String ipHmac) {
        Instant createdAt = clock.instant().truncatedTo(ChronoUnit.SECONDS);
        long now = createdAt.getEpochSecond();
        if (replyId <= 0) throw new ApiException(ApiErrorCode.INVALID_REPLY_ID);
        if (!replyRepository.findById(replyId).isPresent()) throw new ApiException(ApiErrorCode.REPLY_NOT_FOUND);
        reportRepository.deleteExpiredReplyReport(reporterId, replyId, now);
        if (reportRepository.hasLiveReplyReport(reporterId, replyId, now)) throw new ApiException(ApiErrorCode.DUPLICATE_REPORT);
        ContentReport report = insert(
                reporterId, ContentReportTargetType.REPLY, replyId, request, createdAt);
        signalRecorder.recordReportCreated(reporterId, report.id(), ipHmac);
        return report;
    }

    private ContentReport insert(long reporterId, ContentReportTargetType type, long targetId,
                                 CreateContentReportRequest request, Instant createdAt) {
        try {
            return reportRepository.insert(reporterId, type, targetId, request.reason(), createdAt,
                    createdAt.getEpochSecond() + RETENTION_SECONDS);
        } catch (DataAccessException exception) {
            SQLiteException sqliteException = mostSpecificSqliteException(exception);
            if (sqliteException != null
                    && sqliteException.getResultCode() == SQLiteErrorCode.SQLITE_CONSTRAINT_UNIQUE) {
                throw new ApiException(ApiErrorCode.DUPLICATE_REPORT, exception);
            }
            throw exception;
        }
    }

    private static SQLiteException mostSpecificSqliteException(Throwable exception) {
        Throwable current = exception;
        while (current != null) {
            if (current instanceof SQLiteException sqliteException) {
                return sqliteException;
            }
            current = current.getCause();
        }
        return null;
    }
}
