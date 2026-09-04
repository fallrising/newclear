package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.RepostState;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PostRepostRepositoryTest {

    @Autowired
    private PostRepostRepository postRepostRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void repeatedRepostIsIdempotentAndDoesNotBumpTimestamp() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(alice.id(), "First post", "home");

        postRepostRepository.repost(post.id(), alice.id());
        jdbcClient
                .sql("""
                        UPDATE post_reposts SET created_at = '2024-01-01 00:00:00'
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", post.id())
                .param("accountId", alice.id())
                .update();
        postRepostRepository.repost(post.id(), alice.id());

        RepostState state = postRepostRepository.getState(post.id(), alice.id());
        assertThat(state.postId()).isEqualTo(post.id());
        assertThat(state.repostCount()).isEqualTo(1);
        assertThat(state.repostedByViewer()).isTrue();

        assertThat(repostRelationCount(post.id(), alice.id())).isEqualTo(1);
        assertThat(repostCreatedAt(post.id(), alice.id())).isEqualTo("2024-01-01 00:00:00");
    }

    @Test
    void repeatedUnrepostIsIdempotentAndNeverGoesNegative() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(alice.id(), "First post", "home");

        postRepostRepository.repost(post.id(), alice.id());
        postRepostRepository.unrepost(post.id(), alice.id());
        postRepostRepository.unrepost(post.id(), alice.id());

        RepostState state = postRepostRepository.getState(post.id(), alice.id());
        assertThat(state.postId()).isEqualTo(post.id());
        assertThat(state.repostCount()).isZero();
        assertThat(state.repostedByViewer()).isFalse();

        assertThat(repostRelationCount(post.id(), alice.id())).isZero();
    }

    @Test
    void twoAccountsShareCountWithIsolatedViewerState() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Post post = postRepository.insertOwned(alice.id(), "Shared post", "home");

        postRepostRepository.repost(post.id(), alice.id());
        postRepostRepository.repost(post.id(), bob.id());

        RepostState aliceState = postRepostRepository.getState(post.id(), alice.id());
        assertThat(aliceState.repostCount()).isEqualTo(2);
        assertThat(aliceState.repostedByViewer()).isTrue();

        RepostState bobState = postRepostRepository.getState(post.id(), bob.id());
        assertThat(bobState.repostCount()).isEqualTo(2);
        assertThat(bobState.repostedByViewer()).isTrue();

        RepostState carolState = postRepostRepository.getState(post.id(), carol.id());
        assertThat(carolState.repostCount()).isEqualTo(2);
        assertThat(carolState.repostedByViewer()).isFalse();

        postRepostRepository.unrepost(post.id(), bob.id());

        RepostState afterBobUnrepost = postRepostRepository.getState(post.id(), alice.id());
        assertThat(afterBobUnrepost.repostCount()).isEqualTo(1);
        assertThat(afterBobUnrepost.repostedByViewer()).isTrue();

        RepostState carolAfter = postRepostRepository.getState(post.id(), carol.id());
        assertThat(carolAfter.repostCount()).isEqualTo(1);
        assertThat(carolAfter.repostedByViewer()).isFalse();

        assertThat(repostRelationCount(post.id(), alice.id())).isEqualTo(1);
        assertThat(repostRelationCount(post.id(), bob.id())).isZero();
    }

    @Test
    void accountAndPostDeletesCascadeRepostActivities() {
        Account author = accountRepository.insert("author", "Author", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Post post = postRepository.insertOwned(author.id(), "Shared post", "home");

        postRepostRepository.repost(post.id(), bob.id());
        jdbcClient
                .sql("DELETE FROM accounts WHERE id = :accountId")
                .param("accountId", bob.id())
                .update();

        assertThat(repostRelationCount(post.id(), bob.id())).isZero();
        assertThat(postRepository.existsById(post.id())).isTrue();

        postRepostRepository.repost(post.id(), carol.id());
        jdbcClient
                .sql("DELETE FROM posts WHERE id = :postId")
                .param("postId", post.id())
                .update();

        assertThat(repostRelationCount(post.id(), carol.id())).isZero();
    }

    private long repostRelationCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }

    private String repostCreatedAt(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT created_at FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(String.class)
                .single();
    }
}
