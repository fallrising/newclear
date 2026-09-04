package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Account;
import com.example.deck.model.NotificationSummary;
import com.example.deck.model.NotificationType;
import com.example.deck.model.Post;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class NotificationReadRepositoryTest {

    @Autowired
    private NotificationReadRepository notificationReadRepository;

    @Autowired
    private NotificationRepository notificationRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Test
    void readThroughDefaultsToZeroWhenNoStateRowExists() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");

        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isZero();
    }

    @Test
    void summaryReadThroughDefaultsToZeroAndCountsRetainedRows() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Bob post", "home");
        notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);
        notificationRepository.insertAndPrune(
                bob.id(), alice.id(), post.id(), null, NotificationType.LIKE);

        NotificationSummary summary = notificationRepository.findSummary(bob.id());

        assertThat(summary.readThroughId()).isZero();
        assertThat(summary.unreadCount()).isEqualTo(2);
    }

    @Test
    void advanceIsMonotonicAndNeverStepsBackwards() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");

        assertThat(notificationReadRepository.advanceReadThrough(bob.id(), 100))
                .isEqualTo(100);
        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isEqualTo(100);

        assertThat(notificationReadRepository.advanceReadThrough(bob.id(), 50)).isEqualTo(100);
        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isEqualTo(100);

        assertThat(notificationReadRepository.advanceReadThrough(bob.id(), 150)).isEqualTo(150);
        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isEqualTo(150);
    }

    @Test
    void unreadCountTracksMonotonicReadThrough() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(bob.id(), "Bob post", "home");

        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            ids.add(notificationRepository.insertAndPrune(
                    bob.id(), alice.id(), post.id(), null, NotificationType.LIKE));
        }

        NotificationSummary before = notificationRepository.findSummary(bob.id());
        assertThat(before.unreadCount()).isEqualTo(3);

        notificationReadRepository.advanceReadThrough(bob.id(), ids.get(1));
        NotificationSummary after = notificationRepository.findSummary(bob.id());
        assertThat(after.readThroughId()).isEqualTo(ids.get(1));
        assertThat(after.unreadCount()).isEqualTo(1);

        notificationReadRepository.advanceReadThrough(bob.id(), ids.get(2));
        NotificationSummary done = notificationRepository.findSummary(bob.id());
        assertThat(done.readThroughId()).isEqualTo(ids.get(2));
        assertThat(done.unreadCount()).isZero();
    }

    @Test
    void ownedRetainedCursorsAreRequiredAndIsolatedByRecipient() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post bobPost = postRepository.insertOwned(bob.id(), "Bob post", "home");
        Post carolPost = postRepository.insertOwned(carol.id(), "Carol post", "home");

        long bobNotification = notificationRepository.insertAndPrune(
                bob.id(), alice.id(), bobPost.id(), null, NotificationType.LIKE);
        long carolNotification = notificationRepository.insertAndPrune(
                carol.id(), alice.id(), carolPost.id(), null, NotificationType.LIKE);

        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), bobNotification))
                .isTrue();
        assertThat(notificationReadRepository.isOwnedRetained(carol.id(), carolNotification))
                .isTrue();

        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), carolNotification))
                .isFalse();
        assertThat(notificationReadRepository.isOwnedRetained(carol.id(), bobNotification))
                .isFalse();

        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), 999_999)).isFalse();
        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), 0)).isFalse();
    }

    @Test
    void ownedRetainedRejectsPrunedIdsAndKeepsCrossRecipientIsolation() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Account actor = accountRepository.insert("actor", "Actor", "hash");
        Post bobPost = postRepository.insertOwned(bob.id(), "Bob post", "home");

        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            ids.add(notificationRepository.insertAndPrune(
                    bob.id(), actor.id(), bobPost.id(), null, NotificationType.LIKE));
        }
        long prunedOldest = ids.get(0);
        long retainedNewest = ids.get(500);

        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), prunedOldest)).isFalse();
        assertThat(notificationReadRepository.isOwnedRetained(bob.id(), retainedNewest)).isTrue();
        assertThat(notificationReadRepository.isOwnedRetained(carol.id(), retainedNewest)).isFalse();
    }

    @Test
    void summaryPreservesReadThroughWhenNoNotificationsRemain() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");

        notificationReadRepository.advanceReadThrough(bob.id(), 100);

        NotificationSummary summary = notificationRepository.findSummary(bob.id());

        assertThat(summary.latestRetainedId()).isNull();
        assertThat(summary.readThroughId()).isEqualTo(100);
        assertThat(summary.unreadCount()).isZero();
    }

    @Test
    void readStateIsIsolatedByAccount() {
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");

        notificationReadRepository.advanceReadThrough(bob.id(), 10);

        assertThat(notificationReadRepository.findReadThroughId(bob.id())).isEqualTo(10);
        assertThat(notificationReadRepository.findReadThroughId(carol.id())).isZero();
    }
}
