package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.Account;
import com.example.deck.model.NotificationItem;
import com.example.deck.model.NotificationSummary;
import com.example.deck.model.NotificationType;
import com.example.deck.model.Post;
import com.example.deck.model.Reply;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class NotificationRepositoryTest {

    @Autowired
    private NotificationRepository notificationRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void replyLikeRepostPageIsNewestFirstWithCurrentContentAndReadFlag() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Original content", "home");
        Reply reply = replyRepository.insertOwned(post.id(), alice.id(), "Agreed.");

        long replyNotificationId = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), reply.id(), NotificationType.REPLY);
        long likeNotificationId = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long repostNotificationId = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.REPOST);

        assertThat(replyNotificationId).isPositive();
        assertThat(likeNotificationId).isPositive();
        assertThat(repostNotificationId).isPositive();

        List<NotificationItem> page = notificationRepository.findPage(bob.id(), 10, null, 0);
        assertThat(page)
                .extracting(NotificationItem::id)
                .containsExactly(repostNotificationId, likeNotificationId, replyNotificationId);
        assertThat(page)
                .extracting(NotificationItem::type)
                .containsExactly(
                        NotificationType.REPOST, NotificationType.LIKE, NotificationType.REPLY);
        assertThat(page).extracting(NotificationItem::read).containsOnly(false);
        assertThat(page).extracting(NotificationItem::createdAt).doesNotContainNull();

        NotificationItem repost = page.get(0);
        assertThat(repost.actor()).isEqualTo("Alice");
        assertThat(repost.actorHandle()).isEqualTo("alice");
        assertThat(repost.postId()).isEqualTo(post.id());
        assertThat(repost.postContent()).isEqualTo("Original content");
        assertThat(repost.replyId()).isNull();
        assertThat(repost.replyContent()).isNull();

        NotificationItem like = page.get(1);
        assertThat(like.replyId()).isNull();
        assertThat(like.replyContent()).isNull();

        NotificationItem replyNotification = page.get(2);
        assertThat(replyNotification.replyId()).isEqualTo(reply.id());
        assertThat(replyNotification.replyContent()).isEqualTo("Agreed.");

        List<NotificationItem> olderPage = notificationRepository.findPage(
                bob.id(), 10, likeNotificationId, 0);
        assertThat(olderPage)
                .extracting(NotificationItem::id)
                .containsExactly(replyNotificationId);

        List<NotificationItem> readThroughPage =
                notificationRepository.findPage(bob.id(), 10, null, likeNotificationId);
        assertThat(readThroughPage)
                .extracting(NotificationItem::id)
                .containsExactly(repostNotificationId, likeNotificationId, replyNotificationId);
        assertThat(readThroughPage)
                .extracting(NotificationItem::read)
                .containsExactly(false, true, true);

        jdbcClient
                .sql("UPDATE posts SET content = 'Edited content' WHERE id = :id")
                .param("id", post.id())
                .update();
        NotificationItem refreshed =
                notificationRepository.findPage(bob.id(), 10, null, 0).get(2);
        assertThat(refreshed.postContent()).isEqualTo("Edited content");
    }

    @Test
    void notificationsAreIsolatedByRecipientAndReplyIdIsUnique() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post bobPost = postRepository.insertOwned(bob.id(), "Bob post", "home");
        Post carolPost = postRepository.insertOwned(carol.id(), "Carol post", "home");

        Reply carolReply =
                replyRepository.insertOwned(bobPost.id(), carol.id(), "Carol reply");
        notificationRepository.insertAndPrune(
                bob.id(), carol.id(), bobPost.id(), carolReply.id(), NotificationType.REPLY);
        long firstLikeId = notificationRepository.insertAndPrune(
                carol.id(), alice.id(), carolPost.id(), null, NotificationType.LIKE);

        List<NotificationItem> bobPage = notificationRepository.findPage(bob.id(), 20, null, 0);
        assertThat(bobPage)
                .extracting(NotificationItem::postId)
                .containsExactly(bobPost.id());
        assertThat(bobPage)
                .extracting(NotificationItem::actorHandle)
                .containsExactly("carol");

        List<NotificationItem> carolPage = notificationRepository.findPage(carol.id(), 20, null, 0);
        assertThat(carolPage)
                .extracting(NotificationItem::postId)
                .containsExactly(carolPost.id());
        assertThat(carolPage)
                .extracting(NotificationItem::actorHandle)
                .containsExactly("alice");

        assertThatThrownBy(() ->
                        notificationRepository.insertAndPrune(
                                bob.id(),
                                carol.id(),
                                bobPost.id(),
                                carolReply.id(),
                                NotificationType.REPLY))
                .isInstanceOf(DataAccessException.class);

        long secondLikeId = notificationRepository.insertAndPrune(
                carol.id(), alice.id(), carolPost.id(), null, NotificationType.LIKE);
        assertThat(secondLikeId).isGreaterThan(firstLikeId);
        assertThat(notificationRepository.findPage(carol.id(), 20, null, 0))
                .extracting(NotificationItem::id)
                .containsExactly(secondLikeId, firstLikeId);
    }

    @Test
    void insertingFiveHundredFirstKeepsNewestFiveHundredWithoutChangingOtherRecipients() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Account actor = accountRepository.insert("actor", "Actor", "hash");
        Post bobPost = postRepository.insertOwned(bob.id(), "Bob post", "home");
        Post carolPost = postRepository.insertOwned(carol.id(), "Carol post", "home");

        List<Long> bobIds = new ArrayList<>();
        for (int i = 0; i < 500; i++) {
            bobIds.add(notificationRepository.insertAndPrune(
                    bob.id(), actor.id(), bobPost.id(), null, NotificationType.LIKE));
        }
        long oldestBobId = bobIds.get(0);

        List<Long> carolIds = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            carolIds.add(notificationRepository.insertAndPrune(
                    carol.id(), actor.id(), carolPost.id(), null, NotificationType.REPOST));
        }

        long fiveHundredFirst = notificationRepository.insertAndPrune(
                bob.id(), actor.id(), bobPost.id(), null, NotificationType.LIKE);

        assertThat(recipientNotificationCount(bob.id())).isEqualTo(500);
        assertThat(recipientNotificationCount(carol.id())).isEqualTo(5);
        assertThat(notificationExists(oldestBobId)).isFalse();
        assertThat(notificationExists(fiveHundredFirst)).isTrue();
        assertThat(carolIds).allMatch(this::notificationExists);

        List<Long> traversed = pageAllIds(bob.id());
        assertThat(traversed).hasSize(500).doesNotHaveDuplicates();
        assertThat(traversed).contains(fiveHundredFirst).doesNotContain(oldestBobId);
    }

    @Test
    void summaryReportsLatestRetainedReadThroughAndRetainedUnreadCount() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Bob post", "home");

        long first = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long second = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        long third = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);

        jdbcClient
                .sql("""
                        INSERT INTO notification_read_state (account_id, read_through_id)
                        VALUES (:accountId, :readThrough)""")
                .param("accountId", bob.id())
                .param("readThrough", second)
                .update();

        NotificationSummary bobSummary = notificationRepository.findSummary(bob.id());
        assertThat(bobSummary.latestRetainedId()).isEqualTo(third);
        assertThat(bobSummary.readThroughId()).isEqualTo(second);
        assertThat(bobSummary.unreadCount()).isEqualTo(1);

        NotificationSummary carolSummary = notificationRepository.findSummary(carol.id());
        assertThat(carolSummary.latestRetainedId()).isNull();
        assertThat(carolSummary.readThroughId()).isZero();
        assertThat(carolSummary.unreadCount()).isZero();

        assertThat(first).isLessThan(second).isLessThan(third);
    }

    @Test
    void summaryIsBoundedToRetainedRowsAfterPrune() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account actor = accountRepository.insert("actor", "Actor", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Bob post", "home");

        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(notificationRepository.insertAndPrune(
                    bob.id(), actor.id(), post.id(), null, NotificationType.LIKE));
        }

        NotificationSummary summary = notificationRepository.findSummary(bob.id());
        assertThat(summary.latestRetainedId()).isEqualTo(ids.get(500));
        assertThat(summary.readThroughId()).isZero();
        assertThat(summary.unreadCount()).isEqualTo(500);
    }

    @Test
    void strictKeysetPagingHonorsQueryLimitAndReachesAllRowsNewestToOldest() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Bob post", "home");

        List<Long> inserted = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            inserted.add(notificationRepository.insertAndPrune(
                    bob.id(), alice.id(), post.id(), null, NotificationType.LIKE));
        }
        long newest = inserted.get(inserted.size() - 1);

        List<NotificationItem> firstPage = notificationRepository.findPage(bob.id(), 11, null, 0);
        assertThat(firstPage).hasSize(11);
        assertThat(firstPage)
                .extracting(NotificationItem::id)
                .isSortedAccordingTo(Comparator.reverseOrder());
        assertThat(firstPage.get(0).id()).isEqualTo(newest);

        long lastDeliveredBefore = firstPage.get(9).id();
        List<NotificationItem> olderPage =
                notificationRepository.findPage(bob.id(), 11, lastDeliveredBefore, 0);
        assertThat(olderPage).isNotEmpty();
        assertThat(olderPage)
                .extracting(NotificationItem::id)
                .allSatisfy(id -> assertThat(id).isLessThan(lastDeliveredBefore))
                .doesNotContain(newest);

        List<Long> expected = new ArrayList<>(inserted);
        expected.sort(Comparator.reverseOrder());
        assertThat(pageAllWithLookahead(bob.id(), 10)).containsExactlyElementsOf(expected);

        NotificationSummary summary = notificationRepository.findSummary(bob.id());
        assertThat(summary.latestRetainedId()).isEqualTo(newest);
        assertThat(summary.readThroughId()).isZero();
        assertThat(summary.unreadCount()).isEqualTo(25);
    }

    private List<Long> pageAllWithLookahead(long recipientId, int pageSize) {
        List<Long> ids = new ArrayList<>();
        Long beforeId = null;
        while (true) {
            List<NotificationItem> page =
                    notificationRepository.findPage(recipientId, pageSize + 1, beforeId, 0);
            int delivered = Math.min(page.size(), pageSize);
            for (int i = 0; i < delivered; i++) {
                ids.add(page.get(i).id());
            }
            if (page.size() <= pageSize) {
                return ids;
            }
            beforeId = page.get(pageSize - 1).id();
        }
    }

    private List<Long> pageAllIds(long recipientId) {
        List<Long> ids = new ArrayList<>();
        Long beforeId = null;
        while (true) {
            List<NotificationItem> page =
                    notificationRepository.findPage(recipientId, 100, beforeId, 0);
            ids.addAll(page.stream().map(NotificationItem::id).toList());
            if (page.size() < 100) {
                return ids;
            }
            beforeId = page.get(page.size() - 1).id();
        }
    }

    private long recipientNotificationCount(long recipientId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM notifications
                        WHERE recipient_account_id = :recipientId""")
                .param("recipientId", recipientId)
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
}
