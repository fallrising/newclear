package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Account;
import com.example.deck.model.ContentReport;
import com.example.deck.model.ContentReportReason;
import com.example.deck.model.ContentReportTargetType;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.ReplyRepository;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ContentReportRepositoryTest {
    @Autowired ContentReportRepository reports;
    @Autowired AccountRepository accounts;
    @Autowired PostRepository posts;
    @Autowired ReplyRepository replies;
    @Autowired JdbcClient jdbc;

    @Test
    void storesOnlyTheTargetAndReturnsRedactedShape() {
        Account account = accounts.insert("reportrepo", "Reporter", "hash");
        Post post = posts.insert("Author", "Body", "home");
        Instant createdAt = Instant.parse("2026-01-02T03:04:05Z");
        ContentReport report = reports.insert(account.id(), ContentReportTargetType.POST, post.id(),
                ContentReportReason.SPAM, createdAt, 2_000_000_000L);

        assertThat(report.targetType()).isEqualTo(ContentReportTargetType.POST);
        assertThat(report.targetId()).isEqualTo(post.id());
        assertThat(report.reason()).isEqualTo(ContentReportReason.SPAM);
        assertThat(report.status().name()).isEqualTo("RECEIVED");
        assertThat(report.createdAt()).isEqualTo(createdAt);
        assertThat(jdbc.sql("SELECT reporter_account_id, post_id, reply_id, expires_at_epoch FROM content_reports")
                .query((rs, row) -> rs.getLong("reporter_account_id") + ":" + rs.getLong("post_id") + ":"
                        + rs.getObject("reply_id") + ":" + rs.getLong("expires_at_epoch")).single())
                .isEqualTo(account.id() + ":" + post.id() + ":null:2000000000");
    }

    @Test
    void expiredRowsCanBePrunedForExactReporterAndTarget() {
        Account account = accounts.insert("reportprune", "Reporter", "hash");
        Post post = posts.insert("Author", "Body", "home");
        reports.insert(account.id(), ContentReportTargetType.POST, post.id(), ContentReportReason.OTHER,
                Instant.EPOCH, 10);

        assertThat(reports.deleteExpiredPostReport(account.id(), post.id(), 11)).isEqualTo(1);
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports").query(Long.class).single()).isZero();
        assertThat(reports.insert(account.id(), ContentReportTargetType.POST, post.id(), ContentReportReason.SPAM,
                Instant.ofEpochSecond(11), 20).reason()).isEqualTo(ContentReportReason.SPAM);
    }

    @Test
    void isolatesTargetShapesReportersAndCascades() {
        Account first = accounts.insert("reportfirst", "First", "hash");
        Account second = accounts.insert("reportsecond", "Second", "hash");
        Post post = posts.insert("Author", "Body", "home");
        Reply reply = replies.insert(post.id(), "Author", "Reply");
        Instant now = Instant.parse("2026-01-02T03:04:05Z");

        reports.insert(first.id(), ContentReportTargetType.POST, post.id(), ContentReportReason.SPAM, now, 100);
        reports.insert(first.id(), ContentReportTargetType.REPLY, reply.id(), ContentReportReason.OTHER, now, 100);
        reports.insert(second.id(), ContentReportTargetType.POST, post.id(), ContentReportReason.HARASSMENT, now, 100);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reports.insert(first.id(),
                ContentReportTargetType.POST, post.id(), ContentReportReason.OTHER, now, 100))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reports.insert(first.id(),
                ContentReportTargetType.REPLY, reply.id(), ContentReportReason.SPAM, now, 100))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reports.insert(999_999,
                ContentReportTargetType.POST, post.id(), ContentReportReason.SPAM, now, 100))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> reports.insert(first.id(),
                ContentReportTargetType.POST, 999_999, ContentReportReason.SPAM, now, 100))
                .isInstanceOf(org.springframework.dao.DataAccessException.class);
        jdbc.sql("DELETE FROM replies WHERE id = :id").param("id", reply.id()).update();
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports WHERE reply_id = :id").param("id", reply.id())
                .query(Long.class).single()).isZero();
        jdbc.sql("DELETE FROM accounts WHERE id = :id").param("id", second.id()).update();
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports WHERE reporter_account_id = :id").param("id", second.id())
                .query(Long.class).single()).isZero();
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports WHERE post_id = :id").param("id", post.id())
                .query(Long.class).single()).isEqualTo(1);
        jdbc.sql("DELETE FROM posts WHERE id = :id").param("id", post.id()).update();
        assertThat(jdbc.sql("SELECT COUNT(*) FROM content_reports").query(Long.class).single()).isZero();
    }
}
