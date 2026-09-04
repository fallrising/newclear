package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.tuple;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.SearchCursor;
import com.example.deck.service.SearchQueryCompiler;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class SearchRepositoryTest {

    private static final String SHA256 =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Autowired
    private SearchRepository searchRepository;

    @Autowired
    private SearchQueryCompiler queryCompiler;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private PostLikeRepository postLikeRepository;

    @Autowired
    private PostRepostRepository postRepostRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private PostImageRepository postImageRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void matchingPostIsReturnedOnceWithExactContent() {
        Post post = insertAt("Ship the boring fix", "2026-09-03 09:00:00");

        List<Post> results = search(queryCompiler.compile("boring"));

        assertThat(results).extracting(Post::id).containsExactly(post.id());
    }

    @Test
    void allTermsMustMatchWithAnd() {
        Post matching = insertAt("ship the boring fix", "2026-09-03 09:00:02");
        insertAt("ship the curious note", "2026-09-03 09:00:01");
        insertAt("boring unrelated thing", "2026-09-03 09:00:00");

        List<Post> results = search(queryCompiler.compile("ship boring"));

        assertThat(results).extracting(Post::id).containsExactly(matching.id());
    }

    @Test
    void unicodeTermsMatchExactContent() {
        Post chinese = insertAt("ship 中文 note", "2026-09-03 09:00:02");
        Post accented = insertAt("café open", "2026-09-03 09:00:01");

        assertThat(search(queryCompiler.compile("中文"))).extracting(Post::id)
                .containsExactly(chinese.id());
        assertThat(search(queryCompiler.compile("cafe"))).extracting(Post::id)
                .containsExactly(accented.id());
    }

    @Test
    void starPhraseDoesNotEnablePrefixMatching() {
        Post foo = insertAt("foo", "2026-09-03 09:00:02");
        insertAt("foobar", "2026-09-03 09:00:01");

        List<Post> results = search(queryCompiler.compile("foo*"));

        assertThat(results).extracting(Post::id).containsExactly(foo.id());
    }

    @Test
    void operatorAndPunctuationShapedCompiledInputsExecuteWithoutSyntaxErrors() {
        insertAt("alpha OR beta NOT AND NEAR (x) foo^bar col:values ^tag", "2026-09-03 09:00:00");

        for (String input : List.of(
                "NOT", "OR", "AND", "NEAR", "alpha OR beta", "(x)",
                "col:values", "^tag", "foo^bar", "foo*", "*bar")) {
            assertThatCode(() -> search(queryCompiler.compile(input)))
                    .as("compiled input for %s must execute under MATCH", input)
                    .doesNotThrowAnyException();
            assertThat(search(queryCompiler.compile(input)))
                    .as("compiled input for %s must still match", input)
                    .isNotEmpty();
        }
    }

    @Test
    void embeddedQuoteShapedCompiledInputExecutesAndMatchesContent() {
        Post post = insertAt("say\"hi\"now", "2026-09-03 09:00:00");

        assertThatCode(() -> search(queryCompiler.compile("say\"hi\"now")))
                .doesNotThrowAnyException();
        assertThat(search(queryCompiler.compile("say\"hi\"now")))
                .extracting(Post::id)
                .containsExactly(post.id());
    }

    @Test
    void repliesAreNotIndexed() {
        Post post = insertAt("parent content", "2026-09-03 09:00:00");
        replyRepository.insert(post.id(), "Tester", "reply-only keyphrase");

        assertThat(search(queryCompiler.compile("keyphrase"))).isEmpty();
    }

    @Test
    void repostDoesNotDuplicateOriginalResult() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Post post = insertOwnedAt(alice, "repostable unique phrase", "2026-09-03 09:00:00");
        postRepostRepository.repost(post.id(), bob.id());

        List<Post> results = search(queryCompiler.compile("repostable"));

        assertThat(results).extracting(Post::id).containsExactly(post.id());
        assertThat(results.get(0).repostCount()).isEqualTo(1);
    }

    @Test
    void equalTimestampsOrderByIdDescAndKeysetContinues() {
        Post first = insertAt("equal alpha", "2026-09-03 09:00:00");
        Post second = insertAt("equal beta", "2026-09-03 09:00:00");
        Post third = insertAt("equal gamma", "2026-09-03 09:00:00");

        List<Post> firstPage = search(queryCompiler.compile("equal"), 2, null);
        Post boundary = firstPage.get(firstPage.size() - 1);
        List<Post> secondPage = search(
                queryCompiler.compile("equal"),
                2,
                new SearchCursor(boundary.createdAt(), boundary.id()));

        assertThat(firstPage).extracting(Post::id).containsExactly(third.id(), second.id());
        assertThat(secondPage).extracting(Post::id).containsExactly(first.id());
    }

    @Test
    void paginationAcrossManyRowsHasNoOverlapAndNoGap() {
        List<Post> posts = List.of(
                insertAt("page", "2026-09-03 09:00:00"),
                insertAt("page", "2026-09-03 09:00:01"),
                insertAt("page", "2026-09-03 09:00:02"),
                insertAt("page", "2026-09-03 09:00:03"),
                insertAt("page", "2026-09-03 09:00:04"));

        List<Post> p1 = search(queryCompiler.compile("page"), 2, null);
        SearchCursor boundary1 =
                new SearchCursor(p1.get(p1.size() - 1).createdAt(), p1.get(p1.size() - 1).id());
        List<Post> p2 = search(queryCompiler.compile("page"), 2, boundary1);
        SearchCursor boundary2 =
                new SearchCursor(p2.get(p2.size() - 1).createdAt(), p2.get(p2.size() - 1).id());
        List<Post> p3 = search(queryCompiler.compile("page"), 2, boundary2);

        assertThat(p1).extracting(Post::id).containsExactly(posts.get(4).id(), posts.get(3).id());
        assertThat(p2).extracting(Post::id).containsExactly(posts.get(2).id(), posts.get(1).id());
        assertThat(p3).extracting(Post::id).containsExactly(posts.get(0).id());

        List<Long> all = List.of(p1, p2, p3).stream().flatMap(page -> page.stream())
                .map(Post::id).toList();
        assertThat(all).containsExactly(
                posts.get(4).id(), posts.get(3).id(), posts.get(2).id(),
                posts.get(1).id(), posts.get(0).id());
    }

    @Test
    void newerMatchingInsertBetweenPagesIsExcludedFromOlderPage() {
        Post oldest = insertAt("shared phrase", "2026-09-03 09:00:00");
        Post middle = insertAt("shared phrase", "2026-09-03 09:00:01");
        Post latest = insertAt("shared phrase", "2026-09-03 09:00:02");

        List<Post> firstPage = search(queryCompiler.compile("shared"), 2, null);
        Post boundary = firstPage.get(firstPage.size() - 1);
        Post newerBetweenPages = insertAt("shared phrase", "2026-09-03 09:00:03");
        List<Post> secondPage = search(
                queryCompiler.compile("shared"),
                20,
                new SearchCursor(boundary.createdAt(), boundary.id()));

        assertThat(firstPage).extracting(Post::id).containsExactly(latest.id(), middle.id());
        assertThat(secondPage).extracting(Post::id)
                .startsWith(oldest.id())
                .doesNotContain(latest.id(), middle.id(), newerBetweenPages.id());
    }

    @Test
    void fetchLimitIsBounded() {
        for (int i = 0; i < 5; i++) {
            insertAt("bounded phrase", "2026-09-03 09:00:0" + i);
        }

        assertThat(search(queryCompiler.compile("bounded"), 2, null)).hasSize(2);
        assertThat(search(queryCompiler.compile("bounded"), 50, null)).hasSize(5);
    }

    @Test
    void nonexistentCursorBoundaryStillOrdersStrictlyOlderResults() {
        Post newest = insertAt("navigate", "2026-09-03 09:00:02");
        Post sameTimestamp = insertAt("navigate", "2026-09-03 09:00:01");
        Post older = insertAt("navigate", "2026-09-03 09:00:00");

        List<Post> firstPage = search(queryCompiler.compile("navigate"), 20, null);
        assertThat(firstPage).extracting(Post::id)
                .containsExactly(newest.id(), sameTimestamp.id(), older.id());

        SearchCursor ghostBoundary =
                new SearchCursor(Instant.parse("2026-09-03T09:00:01Z"), sameTimestamp.id() - 1);
        List<Post> secondPage = search(queryCompiler.compile("navigate"), 20, ghostBoundary);

        assertThat(secondPage).extracting(Post::id).containsExactly(older.id());
    }

    @Test
    void anonymousProjectionMirrorsTimelinePostShape() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = insertOwnedAt(alice, "projection phrase", "2026-09-03 09:00:00");
        postLikeRepository.like(post.id(), alice.id());
        postRepostRepository.repost(post.id(), alice.id());
        replyRepository.insert(post.id(), "Tester", "a reply");

        List<Post> results = search(queryCompiler.compile("projection"));

        assertThat(results).hasSize(1);
        Post actual = results.get(0);
        assertThat(actual.author()).isEqualTo("Alice");
        assertThat(actual.authorHandle()).isEqualTo("alice");
        assertThat(actual.content()).isEqualTo("projection phrase");
        assertThat(actual.channel()).isEqualTo("home");
        assertThat(actual.createdAt()).isEqualTo(Instant.parse("2026-09-03T09:00:00Z"));
        assertThat(actual.replyCount()).isEqualTo(1);
        assertThat(actual.likeCount()).isEqualTo(1);
        assertThat(actual.likedByViewer()).isFalse();
        assertThat(actual.timelineEntryId()).isEqualTo("post:" + post.id());
        assertThat(actual.repostCount()).isEqualTo(1);
        assertThat(actual.repostedByViewer()).isFalse();
        assertThat(actual.repostedBy()).isNull();
        assertThat(actual.repostedByHandle()).isNull();
        assertThat(actual.repostedAt()).isNull();
    }

    @Test
    void ownedAuthorUsesDisplayNameAndLegacyAuthorFallsBackToAuthor() {
        Account alice = accountRepository.insert("alice", "Display Alice", "hash");
        Post owned = insertOwnedAt(alice, "owned phrase", "2026-09-03 09:00:01");
        Post legacy = insertAt("legacy phrase", "2026-09-03 09:00:00");

        List<Post> ownedResults = search(queryCompiler.compile("owned"));
        assertThat(ownedResults)
                .extracting(Post::author, Post::authorHandle)
                .containsExactly(tuple("Display Alice", "alice"));

        List<Post> legacyResults = search(queryCompiler.compile("legacy"));
        assertThat(legacyResults).extracting(Post::author).containsExactly("legacy author");
        assertThat(legacyResults).extracting(Post::authorHandle).containsNull();

        assertThat(owned.id()).isNotEqualTo(legacy.id());
    }

    @Test
    void authenticatedViewerSeesFlagsWhileCountsStayShared() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Account bob = accountRepository.insert("bob", "Bob", "hash");
        Post post = insertOwnedAt(alice, "viewer flags phrase", "2026-09-03 09:00:00");
        postLikeRepository.like(post.id(), alice.id());
        postLikeRepository.like(post.id(), bob.id());
        postRepostRepository.repost(post.id(), alice.id());

        String query = queryCompiler.compile("viewer");
        List<Post> anonymous = searchRepository.findResults(query, null, null, 20);
        List<Post> asAlice = searchRepository.findResults(query, alice.id(), null, 20);
        List<Post> asBob = searchRepository.findResults(query, bob.id(), null, 20);

        assertThat(anonymous.get(0).likeCount()).isEqualTo(2);
        assertThat(anonymous.get(0).repostCount()).isEqualTo(1);
        assertThat(anonymous.get(0).likedByViewer()).isFalse();
        assertThat(anonymous.get(0).repostedByViewer()).isFalse();

        assertThat(asAlice.get(0).likeCount()).isEqualTo(2);
        assertThat(asAlice.get(0).likedByViewer()).isTrue();
        assertThat(asAlice.get(0).repostCount()).isEqualTo(1);
        assertThat(asAlice.get(0).repostedByViewer()).isTrue();

        assertThat(asBob.get(0).likedByViewer()).isTrue();
        assertThat(asBob.get(0).repostedByViewer()).isFalse();
        assertThat(asBob.get(0).likeCount()).isEqualTo(2);
        assertThat(asBob.get(0).repostCount()).isEqualTo(1);
    }

    @Test
    void nonMatchingQueryReturnsEmptyList() {
        insertAt("known content", "2026-09-03 09:00:00");

        assertThat(search(queryCompiler.compile("nothing-matches"))).isEmpty();
    }

    @Test
    void sameQueryIsDeterministicAcrossCalls() {
        for (int i = 0; i < 4; i++) {
            insertAt("stable phrase", "2026-09-03 09:00:0" + i);
        }

        List<Long> first = search(queryCompiler.compile("stable")).stream().map(Post::id).toList();
        List<Long> second = search(queryCompiler.compile("stable")).stream().map(Post::id).toList();

        assertThat(second).isEqualTo(first);
        assertThat(first).isSortedAccordingTo(Comparator.reverseOrder());
    }

    @Test
    void searchResultForOriginalWithImageProjectsSharedPublicImage() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        Post post = insertOwnedAt(alice, "image phrase", "2026-09-03 09:00:00");
        long imageId = postImageRepository.insert(
                post.id(), "key-1", "image/png", 2048, 640, 480, SHA256);

        List<Post> results = search(queryCompiler.compile("image"));

        assertThat(results).hasSize(1);
        Post actual = results.get(0);
        assertThat(actual.image()).isNotNull();
        assertThat(actual.image().id()).isEqualTo(imageId);
        assertThat(actual.image().url()).isEqualTo("/api/media/" + imageId);
        assertThat(actual.image().contentType()).isEqualTo("image/png");
        assertThat(actual.image().byteSize()).isEqualTo(2048);
        assertThat(actual.image().width()).isEqualTo(640);
        assertThat(actual.image().height()).isEqualTo(480);
        assertThat(actual.timelineEntryId()).isEqualTo("post:" + post.id());
        assertThat(actual.likedByViewer()).isFalse();
        assertThat(actual.repostedByViewer()).isFalse();
        assertThat(actual.repostedBy()).isNull();
        assertThat(actual.repostedByHandle()).isNull();
        assertThat(actual.repostedAt()).isNull();
    }

    @Test
    void searchResultForLegacyPostProjectsNullImage() {
        insertAt("no image phrase", "2026-09-03 09:00:00");

        List<Post> results = search(queryCompiler.compile("image"));

        assertThat(results).hasSize(1);
        assertThat(results.get(0).image()).isNull();
        assertThat(results.get(0).author()).isEqualTo("legacy author");
        assertThat(results.get(0).authorHandle()).isNull();
    }

    private List<Post> search(String compiledQuery) {
        return search(compiledQuery, 50, null);
    }

    private List<Post> search(String compiledQuery, int fetchLimit, SearchCursor before) {
        return searchRepository.findResults(compiledQuery, null, before, fetchLimit);
    }

    private Post insertAt(String content, String createdAt) {
        Post post = postRepository.insert("legacy author", content, "home");
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }

    private Post insertOwnedAt(Account account, String content, String createdAt) {
        Post post = postRepository.insertOwned(account.id(), content, "home");
        jdbcClient
                .sql("UPDATE posts SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(post.id())
                .update();
        return postRepository.findById(post.id()).orElseThrow();
    }
}