package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.PostCursor;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PostRepositoryTest {

    private static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private PostImageRepository postImageRepository;

    @Autowired
    private PostRepostRepository postRepostRepository;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void newerIdComesFirstWhenPostsHaveTheSameTimestamp() {
        Post first = insertAt("First post", "home", "9999-12-31 23:59:59");
        Post second = insertAt("Second post", "home", "9999-12-31 23:59:59");

        assertThat(postRepository.findPage(null, 20, null))
                .extracting(Post::id)
                .startsWith(second.id(), first.id());
        assertThat(postRepository.findPage("home", 20, null))
                .extracting(Post::id)
                .startsWith(second.id(), first.id());
    }

    @Test
    void pageSizeIsBounded() {
        assertThat(postRepository.findPage(null, 2, null)).hasSize(2);
        assertThat(postRepository.findPage("tech", 2, null)).hasSize(2);
    }

    @Test
    void cursorUsesTimestampAndIdAcrossEqualTimestamps() {
        Post first = insertAt("First post", "home", "9999-12-31 23:59:59");
        Post second = insertAt("Second post", "home", "9999-12-31 23:59:59");
        Post third = insertAt("Third post", "home", "9999-12-31 23:59:59");

        List<Post> firstPage = postRepository.findPage("home", 2, null);
        Post boundary = firstPage.get(1);
        List<Post> secondPage = postRepository.findPage(
                "home",
                2,
                new PostCursor(boundary.createdAt(), boundary.id()));

        assertThat(firstPage).extracting(Post::id).containsExactly(third.id(), second.id());
        assertThat(secondPage).extracting(Post::id).startsWith(first.id());
    }

    @Test
    void cursorIgnoresNewerPostsInsertedBetweenPages() {
        Post oldest = insertAt("Oldest post", "home", "9999-12-31 23:59:57");
        Post middle = insertAt("Middle post", "home", "9999-12-31 23:59:58");
        Post latest = insertAt("Latest post", "home", "9999-12-31 23:59:59");

        List<Post> firstPage = postRepository.findPage("home", 2, null);
        Post boundary = firstPage.get(1);
        Post newlyInserted = insertAt("New post", "home", "9999-12-31 23:59:59");
        List<Post> secondPage = postRepository.findPage(
                "home",
                20,
                new PostCursor(boundary.createdAt(), boundary.id()));

        assertThat(firstPage).extracting(Post::id).containsExactly(latest.id(), middle.id());
        assertThat(secondPage).extracting(Post::id)
                .startsWith(oldest.id())
                .doesNotContain(latest.id(), middle.id(), newlyInserted.id());
    }

    @Test
    void channelPageNeverContainsAnotherChannel() {
        insertAt("Newest home post", "home", "9999-12-31 23:59:59");
        insertAt("Newest tech post", "tech", "9999-12-31 23:59:59");

        assertThat(postRepository.findPage("tech", 100, null))
                .extracting(Post::channel)
                .containsOnly("tech");
    }

    private Post insertAt(String content, String channel, String createdAt) {
        Post post = postRepository.insert("Tester", content, channel);
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }

    @Test
    void originalPostWithImageProjectsSharedPublicImage() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = postRepository.insertOwned(alice.id(), "Original post", "home");
        long imageId = postImageRepository.insert(
                post.id(), "key-1", "image/jpeg", 4096, 1200, 800, SHA256);

        Post byId = postRepository.findById(post.id()).orElseThrow();
        assertThat(byId.image()).isNotNull();
        assertThat(byId.image().id()).isEqualTo(imageId);
        assertThat(byId.image().url()).isEqualTo("/api/media/" + imageId);
        assertThat(byId.image().contentType()).isEqualTo("image/jpeg");
        assertThat(byId.image().byteSize()).isEqualTo(4096);
        assertThat(byId.image().width()).isEqualTo(1200);
        assertThat(byId.image().height()).isEqualTo(800);
        assertThat(byId.timelineEntryId()).isEqualTo("post:" + post.id());
        assertThat(byId.author()).isEqualTo("Alice");
        assertThat(byId.authorHandle()).isEqualTo("alice");

        Post timelineEntry = postRepository.findPage(null, 20, null).stream()
                .filter(p -> p.id() == post.id())
                .findFirst()
                .orElseThrow();
        assertThat(timelineEntry.image()).isEqualTo(byId.image());
        assertThat(timelineEntry.timelineEntryId()).isEqualTo("post:" + post.id());
    }

    @Test
    void legacyPostWithoutImageProjectsNullImage() {
        Post legacy = insertAt("Legacy post", "home", "9999-12-31 23:59:59");

        assertThat(postRepository.findById(legacy.id()).orElseThrow().image()).isNull();
        assertThat(postRepository.findPage(null, 20, null).stream()
                        .filter(p -> p.id() == legacy.id())
                        .findFirst()
                        .orElseThrow()
                        .image())
                .isNull();
    }

    @Test
    void repostActivityAndProfileShareOriginalPostImage() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Post original = postRepository.insertOwned(alice.id(), "Reposted post", "home");
        long imageId = postImageRepository.insert(
                original.id(), "key-2", "image/png", 2048, 640, 480, SHA256);
        postRepostRepository.repost(original.id(), bob.id());

        List<Post> timeline = postRepository.findPage(null, 20, null);
        List<Post> originalEntries =
                timeline.stream().filter(p -> p.id() == original.id()).toList();
        assertThat(originalEntries).hasSize(2);
        assertThat(originalEntries).extracting(Post::image)
                .allMatch(image -> image != null
                        && image.id() == imageId
                        && image.url().equals("/api/media/" + imageId));
        assertThat(originalEntries).extracting(Post::timelineEntryId)
                .containsExactly("post:" + original.id(), "repost:" + postRepostId(original, bob));

        List<Post> profile = postRepository.findPageByAccountId(bob.id(), 20, null);
        assertThat(profile).hasSize(1);
        assertThat(profile.get(0).image()).isNotNull();
        assertThat(profile.get(0).image().id()).isEqualTo(imageId);
        assertThat(profile.get(0).image().url()).isEqualTo("/api/media/" + imageId);
        assertThat(profile.get(0).repostedBy()).isEqualTo("Bob");
        assertThat(profile.get(0).repostedByHandle()).isEqualTo("bob");
        assertThat(profile.get(0).repostedAt()).isNotNull();
        assertThat(profile.get(0).timelineEntryId()).startsWith("repost:");
        assertThat(profile.get(0).content()).isEqualTo("Reposted post");
    }

    private long postRepostId(Post post, Account account) {
        return jdbcClient
                .sql("""
                        SELECT id FROM post_reposts
                        WHERE post_id = :postId AND account_id = :accountId""")
                .param("postId", post.id())
                .param("accountId", account.id())
                .query(Long.class)
                .single();
    }
}
