package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.StoredPostImage;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PostImageRepositoryTest {

    private static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Autowired
    private PostImageRepository postImageRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void insertLookupRoundTripPreservesAllMetadata() {
        Post post = insertOwnedPost("Image post");
        long imageId = postImageRepository.insert(
                post.id(), "key-1", "image/jpeg", 2048, 1200, 800, SHA256);

        StoredPostImage byId = postImageRepository.findPositiveId(imageId).orElseThrow();
        StoredPostImage byPost = postImageRepository.findByPostId(post.id()).orElseThrow();

        assertThat(byId).isEqualTo(byPost);
        assertThat(byId.id()).isEqualTo(imageId);
        assertThat(byId.postId()).isEqualTo(post.id());
        assertThat(byId.storageKey()).isEqualTo("key-1");
        assertThat(byId.contentType()).isEqualTo("image/jpeg");
        assertThat(byId.byteSize()).isEqualTo(2048);
        assertThat(byId.width()).isEqualTo(1200);
        assertThat(byId.height()).isEqualTo(800);
        assertThat(byId.sha256()).isEqualTo(SHA256);
        assertThat(byId.createdAt()).isNotNull();
    }

    @Test
    void pngMetadataRoundTripUsesCanonicalValues() {
        Post post = insertOwnedPost("Png post");

        long imageId = postImageRepository.insert(
                post.id(), "key-2", "image/png", 1, 1, 1, SHA256);

        assertThat(postImageRepository.findPositiveId(imageId).orElseThrow().contentType())
                .isEqualTo("image/png");
        assertThat(postImageRepository.findPositiveId(imageId).orElseThrow().byteSize())
                .isEqualTo(1);
    }

    @Test
    void lookupByMissingPositiveIdAndMissingPostIdIsEmpty() {
        Post post = insertOwnedPost("No image post");

        assertThat(postImageRepository.findPositiveId(999L)).isEmpty();
        assertThat(postImageRepository.findByPostId(post.id())).isEmpty();
    }

    @Test
    void postDeleteCascadesMetadataRowWithoutOracleAndKeepsSiblingRow() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post first = postRepository.insertOwned(alice.id(), "First post", "home");
        Post second = postRepository.insertOwned(alice.id(), "Second post", "home");
        long firstImage = postImageRepository.insert(
                first.id(), "key-first", "image/jpeg", 100, 10, 10, SHA256);
        postImageRepository.insert(second.id(), "key-second", "image/jpeg", 100, 10, 10, SHA256);

        jdbcClient
                .sql("DELETE FROM posts WHERE id = :postId")
                .param("postId", first.id())
                .update();

        assertThat(postImageRepository.findPositiveId(firstImage)).isEmpty();
        assertThat(postImageRepository.findByPostId(first.id())).isEmpty();
        assertThat(postImageRepository.findByPostId(second.id())).isPresent();
        assertThat(postRepository.existsById(first.id())).isFalse();
        assertThat(postRepository.existsById(second.id())).isTrue();
    }

    @Test
    void secondImageForSamePostViolatesOneToOneConstraint() {
        Post post = insertOwnedPost("One image post");
        postImageRepository.insert(post.id(), "key-a", "image/jpeg", 100, 10, 10, SHA256);

        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), "key-b", "image/jpeg", 100, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void duplicateStorageKeyIsRejectedAcrossDifferentPosts() {
        Account author = accountRepository.insert("alice", "Alice", "hash");
        Post first = postRepository.insertOwned(author.id(), "First key post", "home");
        Post second = postRepository.insertOwned(author.id(), "Second key post", "home");
        postImageRepository.insert(first.id(), "shared-key", "image/jpeg", 100, 10, 10, SHA256);

        assertThatThrownBy(() -> postImageRepository.insert(
                        second.id(), "shared-key", "image/jpeg", 100, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void insertForMissingPostViolatesForeignKey() {
        assertThatThrownBy(() -> postImageRepository.insert(
                        999L, "orphan-key", "image/jpeg", 100, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
    }

    @Test
    void strictChecksRejectInvalidMetadataValues() {
        Post post = insertOwnedPost("Checks post");
        String storageKey = "key-";

        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "gif", "image/gif", 100, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "big", "image/jpeg", 5242881, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "zero", "image/jpeg", 0, 10, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "w0", "image/jpeg", 100, 0, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "whigh", "image/jpeg", 100, 4097, 10, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "h0", "image/jpeg", 100, 10, 0, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "hhigh", "image/jpeg", 100, 10, 4097, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "pixels", "image/jpeg", 100, 4000, 3001, SHA256))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "upper", "image/jpeg", 100, 10, 10,
                        "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789"))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "short", "image/jpeg", 100, 10, 10, "abc"))
                .isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> postImageRepository.insert(
                        post.id(), storageKey + "nonhex", "image/jpeg", 100, 10, 10,
                        "gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"))
                .isInstanceOf(DataAccessException.class);

        assertThat(postImageRepository.findByPostId(post.id())).isEmpty();
        assertThat(imageCount()).isZero();
    }

    private Post insertOwnedPost(String content) {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        return postRepository.insertOwned(alice.id(), content, "home");
    }

    private long imageCount() {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM post_images")
                .query(Long.class)
                .single();
    }
}