package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Account;
import com.example.deck.model.LikeState;
import com.example.deck.model.Post;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PostLikeRepositoryTest {

    @Autowired
    private PostLikeRepository postLikeRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void repeatedLikeIsIdempotentAndKeepsSingleRelation() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(alice.id(), "First post", "home");

        postLikeRepository.like(post.id(), alice.id());
        postLikeRepository.like(post.id(), alice.id());

        LikeState state = postLikeRepository.getState(post.id(), alice.id());
        assertThat(state.postId()).isEqualTo(post.id());
        assertThat(state.likeCount()).isEqualTo(1);
        assertThat(state.likedByViewer()).isTrue();

        assertThat(likeRelationCount(post.id(), alice.id())).isEqualTo(1);
    }

    @Test
    void repeatedUnlikeIsIdempotentAndNeverGoesNegative() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(alice.id(), "First post", "home");

        postLikeRepository.like(post.id(), alice.id());
        postLikeRepository.unlike(post.id(), alice.id());
        postLikeRepository.unlike(post.id(), alice.id());

        LikeState state = postLikeRepository.getState(post.id(), alice.id());
        assertThat(state.postId()).isEqualTo(post.id());
        assertThat(state.likeCount()).isZero();
        assertThat(state.likedByViewer()).isFalse();

        assertThat(likeRelationCount(post.id(), alice.id())).isZero();
    }

    @Test
    void twoAccountsShareCountWithIsolatedViewerState() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Account carol = accountRepository.insert("carol", "Carol", "hash");
        Post post = postRepository.insertOwned(alice.id(), "Shared post", "home");

        postLikeRepository.like(post.id(), alice.id());
        postLikeRepository.like(post.id(), bob.id());

        LikeState aliceState = postLikeRepository.getState(post.id(), alice.id());
        assertThat(aliceState.likeCount()).isEqualTo(2);
        assertThat(aliceState.likedByViewer()).isTrue();

        LikeState bobState = postLikeRepository.getState(post.id(), bob.id());
        assertThat(bobState.likeCount()).isEqualTo(2);
        assertThat(bobState.likedByViewer()).isTrue();

        LikeState carolState = postLikeRepository.getState(post.id(), carol.id());
        assertThat(carolState.likeCount()).isEqualTo(2);
        assertThat(carolState.likedByViewer()).isFalse();

        postLikeRepository.unlike(post.id(), bob.id());

        LikeState afterBobUnlike = postLikeRepository.getState(post.id(), alice.id());
        assertThat(afterBobUnlike.likeCount()).isEqualTo(1);
        assertThat(afterBobUnlike.likedByViewer()).isTrue();

        LikeState carolAfter = postLikeRepository.getState(post.id(), carol.id());
        assertThat(carolAfter.likeCount()).isEqualTo(1);
        assertThat(carolAfter.likedByViewer()).isFalse();

        assertThat(likeRelationCount(post.id(), alice.id())).isEqualTo(1);
        assertThat(likeRelationCount(post.id(), bob.id())).isZero();
    }

    private long likeRelationCount(long postId, long accountId) {
        return jdbcClient
                .sql("""
                        SELECT COUNT(*) FROM post_likes
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", postId)
                .param("accountId", accountId)
                .query(Long.class)
                .single();
    }
}
