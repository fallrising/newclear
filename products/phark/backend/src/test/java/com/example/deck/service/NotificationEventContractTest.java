package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.dto.CreateReplyRequest;
import com.example.deck.model.Account;
import com.example.deck.model.NotificationItem;
import com.example.deck.model.NotificationType;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import com.example.deck.repository.AccountRepository;
import com.example.deck.repository.NotificationRepository;
import com.example.deck.repository.PostRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
class NotificationEventContractTest {

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private NotificationRepository notificationRepository;

    @Autowired
    private ReplyService replyService;

    @Autowired
    private PostLikeService postLikeService;

    @Autowired
    private PostRepostService postRepostService;

    @Autowired
    private JdbcClient jdbcClient;

    private final List<Account> createdAccounts = new ArrayList<>();
    private final List<Post> createdPosts = new ArrayList<>();

    @AfterEach
    void deleteTestScratchData() {
        for (Post post : createdPosts) {
            jdbcClient
                    .sql("DELETE FROM posts WHERE id = :id")
                    .param("id", post.id())
                    .update();
        }
        for (Account account : createdAccounts) {
            jdbcClient
                    .sql("DELETE FROM accounts WHERE id = :id")
                    .param("id", account.id())
                    .update();
        }
        createdPosts.clear();
        createdAccounts.clear();
    }

    @Test
    void aliceReplyLikeRepostOnOwnedPostGiveBobOnlyNewestFirstEventsWithReplyId() {
        String bobHandle = unique("bob");
        String aliceHandle = unique("alice");
        Account bob = newAccount(bobHandle, "Bob");
        Account alice = newAccount(aliceHandle, "Alice");
        Post post = newOwnedPost(bob, "Original content");

        Reply reply = replyService.createReply(
                post.id(), alice.id(), new CreateReplyRequest("Ship the boring fix first."),
                "a".repeat(64));
        postLikeService.like(post.id(), alice.id());
        postRepostService.repost(post.id(), alice.id());

        List<NotificationItem> bobPage = notificationRepository.findPage(bob.id(), 100, null, 0);
        assertThat(bobPage)
                .extracting(NotificationItem::type)
                .containsExactly(
                        NotificationType.REPOST, NotificationType.LIKE, NotificationType.REPLY);
        assertThat(bobPage).extracting(NotificationItem::actor).containsOnly("Alice");
        assertThat(bobPage)
                .extracting(NotificationItem::actorHandle)
                .containsOnly(aliceHandle);
        assertThat(bobPage).extracting(NotificationItem::postId).containsOnly(post.id());
        assertThat(bobPage).extracting(NotificationItem::read).containsOnly(false);

        NotificationItem replyNotification = bobPage.get(2);
        assertThat(replyNotification.replyId()).isEqualTo(reply.id());
        assertThat(replyNotification.replyContent()).isEqualTo("Ship the boring fix first.");

        assertThat(notificationRepository.findPage(alice.id(), 100, null, 0)).isEmpty();
    }

    @Test
    void selfAndLegacyOwnerInteractionsCreateNoNotificationsWhileMutationsSucceed() {
        Account bob = newAccount(unique("bob"), "Bob");
        Account alice = newAccount(unique("alice"), "Alice");
        Post owned = newOwnedPost(bob, "Self post");
        Post legacy = newLegacyPost("Legacy Author", "Legacy post");

        replyService.createReply(
                owned.id(), bob.id(), new CreateReplyRequest("self reply"), "a".repeat(64));
        postLikeService.like(owned.id(), bob.id());
        postRepostService.repost(owned.id(), bob.id());

        replyService.createReply(
                legacy.id(), alice.id(), new CreateReplyRequest("legacy reply"), "a".repeat(64));
        postLikeService.like(legacy.id(), alice.id());
        postRepostService.repost(legacy.id(), alice.id());

        assertThat(notificationRepository.findPage(bob.id(), 100, null, 0)).isEmpty();
        assertThat(notificationRepository.findPage(alice.id(), 100, null, 0)).isEmpty();
        assertThat(totalNotificationCount()).isZero();

        assertThat(replyRowCount(owned.id(), bob.id())).isEqualTo(1);
        assertThat(likeRowCount(owned.id(), bob.id())).isEqualTo(1);
        assertThat(repostRowCount(owned.id(), bob.id())).isEqualTo(1);
        assertThat(replyRowCount(legacy.id(), alice.id())).isEqualTo(1);
        assertThat(likeRowCount(legacy.id(), alice.id())).isEqualTo(1);
        assertThat(repostRowCount(legacy.id(), alice.id())).isEqualTo(1);
    }

    @Test
    void repeatedActiveLikeRepostDoNotDuplicateAndRedoAfterUncancelCreatesNewIds() {
        Account bob = newAccount(unique("bob"), "Bob");
        Account alice = newAccount(unique("alice"), "Alice");
        Post post = newOwnedPost(bob, "Redo post");

        postLikeService.like(post.id(), alice.id());
        Long firstLike = newestNotificationId(bob.id(), NotificationType.LIKE, post.id());
        assertThat(firstLike).as("first LIKE notification id").isNotNull();

        postLikeService.like(post.id(), alice.id());
        assertThat(newestNotificationId(bob.id(), NotificationType.LIKE, post.id()))
                .isEqualTo(firstLike);
        assertThat(notificationCount(bob.id(), NotificationType.LIKE, post.id())).isEqualTo(1);
        assertThat(likeRowCount(post.id(), alice.id())).isEqualTo(1);

        postLikeService.unlike(post.id(), alice.id());
        assertThat(notificationExists(firstLike)).isTrue();
        assertThat(likeRowCount(post.id(), alice.id())).isZero();

        postLikeService.like(post.id(), alice.id());
        Long reDidLike = newestNotificationId(bob.id(), NotificationType.LIKE, post.id());
        assertThat(reDidLike).isGreaterThan(firstLike);
        assertThat(notificationCount(bob.id(), NotificationType.LIKE, post.id())).isEqualTo(2);
        assertThat(likeRowCount(post.id(), alice.id())).isEqualTo(1);

        postRepostService.repost(post.id(), alice.id());
        Long firstRepost = newestNotificationId(bob.id(), NotificationType.REPOST, post.id());
        assertThat(firstRepost).as("first REPOST notification id").isNotNull();

        postRepostService.repost(post.id(), alice.id());
        assertThat(newestNotificationId(bob.id(), NotificationType.REPOST, post.id()))
                .isEqualTo(firstRepost);
        assertThat(notificationCount(bob.id(), NotificationType.REPOST, post.id())).isEqualTo(1);
        assertThat(repostRowCount(post.id(), alice.id())).isEqualTo(1);

        postRepostService.unrepost(post.id(), alice.id());
        assertThat(notificationExists(firstRepost)).isTrue();
        assertThat(repostRowCount(post.id(), alice.id())).isZero();

        postRepostService.repost(post.id(), alice.id());
        Long reDidRepost = newestNotificationId(bob.id(), NotificationType.REPOST, post.id());
        assertThat(reDidRepost).isGreaterThan(firstRepost);
        assertThat(notificationCount(bob.id(), NotificationType.REPOST, post.id())).isEqualTo(2);
        assertThat(repostRowCount(post.id(), alice.id())).isEqualTo(1);
    }

    @Test
    void abortedNotificationInsertRollsBackReplyLikeAndRepostMutations() {
        Account bob = newAccount(unique("bob"), "Bob");
        Account alice = newAccount(unique("alice"), "Alice");
        Post post = newOwnedPost(bob, "Atomic post");

        String triggerName = "red_abort_notify_" + SEQUENCE.incrementAndGet();
        jdbcClient
                .sql("""
                        CREATE TRIGGER %s BEFORE INSERT ON notifications
                        BEGIN
                            SELECT RAISE(ABORT, 'notification insert blocked');
                        END
                        """.formatted(triggerName))
                .update();

        try {
            SoftAssertions softly = new SoftAssertions();
            softly.assertThatThrownBy(() -> replyService.createReply(
                            post.id(), alice.id(), new CreateReplyRequest("Atomic reply"),
                            "a".repeat(64)))
                    .isInstanceOf(DataAccessException.class);
            softly.assertThat(replyRowCount(post.id(), alice.id())).isZero();
            softly.assertThat(replySignalCount(alice.id())).isZero();

            softly.assertThatThrownBy(() -> postLikeService.like(post.id(), alice.id()))
                    .isInstanceOf(DataAccessException.class);
            softly.assertThat(likeRowCount(post.id(), alice.id())).isZero();

            softly.assertThatThrownBy(() -> postRepostService.repost(post.id(), alice.id()))
                    .isInstanceOf(DataAccessException.class);
            softly.assertThat(repostRowCount(post.id(), alice.id())).isZero();
            softly.assertAll();
        } finally {
            jdbcClient
                    .sql("DROP TRIGGER IF EXISTS %s".formatted(triggerName))
                    .update();
        }
    }

    private Account newAccount(String handle, String displayName) {
        Account account = accountRepository.insert(handle, displayName, "hash");
        createdAccounts.add(account);
        return account;
    }

    private Post newOwnedPost(Account owner, String content) {
        Post post = postRepository.insertOwned(owner.id(), content, "home");
        createdPosts.add(post);
        return post;
    }

    private Post newLegacyPost(String author, String content) {
        Post post = postRepository.insert(author, content, "home");
        createdPosts.add(post);
        return post;
    }

    private static String unique(String prefix) {
        return prefix + "_red" + SEQUENCE.incrementAndGet();
    }

    private Long newestNotificationId(long recipientId, NotificationType type, long postId) {
        return jdbcClient
                .sql("""
                        SELECT id FROM notifications
                        WHERE recipient_account_id = :recipientId
                          AND type = :type
                          AND post_id = :postId
                        ORDER BY id DESC
                        LIMIT 1""")
                .param("recipientId", recipientId)
                .param("type", type.name())
                .param("postId", postId)
                .query(Long.class)
                .optional()
                .orElse(null);
    }

    private long notificationCount(long recipientId, NotificationType type, long postId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM notifications
                        WHERE recipient_account_id = :recipientId
                          AND type = :type
                          AND post_id = :postId""")
                .param("recipientId", recipientId)
                .param("type", type.name())
                .param("postId", postId)
                .query(Long.class)
                .single();
    }

    private long totalNotificationCount() {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM notifications")
                .query(Long.class)
                .single();
    }

    private boolean notificationExists(long id) {
        Long count = jdbcClient
                .sql("SELECT COUNT(*) FROM notifications WHERE id = :id")
                .param("id", id)
                .query(Long.class)
                .single();
        return count > 0;
    }

    private long replyRowCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM replies
                        WHERE post_id = :postId AND author_account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long replySignalCount(long accountId) {
        return jdbcClient.sql("""
                        SELECT COUNT(*) FROM abuse_signals
                        WHERE actor_account_id = :accountId
                          AND action_kind = 'REPLY_CREATED'""")
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long likeRowCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_likes
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private long repostRowCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }
}
