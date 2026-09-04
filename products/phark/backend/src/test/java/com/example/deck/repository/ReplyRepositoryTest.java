package com.example.deck.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.model.Post;
import com.example.deck.model.PostCursor;
import com.example.deck.model.Reply;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class ReplyRepositoryTest {

    @Autowired
    private PostRepository postRepository;

    @Autowired
    private ReplyRepository replyRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void repliesAreOldestFirstAndIsolatedByParent() {
        Post firstPost = postRepository.insert("Tester", "First parent", "home");
        Post secondPost = postRepository.insert("Tester", "Second parent", "home");
        Reply oldest = insertAt(firstPost.id(), "Oldest", "9999-12-31 23:59:57");
        Reply newest = insertAt(firstPost.id(), "Newest", "9999-12-31 23:59:59");
        insertAt(secondPost.id(), "Other parent", "9999-12-31 23:59:58");

        assertThat(replyRepository.findPage(firstPost.id(), 20, null))
                .extracting(Reply::id)
                .containsExactly(oldest.id(), newest.id());
    }

    @Test
    void cursorUsesTimestampAndIdAcrossEqualTimestamps() {
        Post post = postRepository.insert("Tester", "Parent", "home");
        Reply first = insertAt(post.id(), "First", "9999-12-31 23:59:59");
        Reply second = insertAt(post.id(), "Second", "9999-12-31 23:59:59");
        Reply third = insertAt(post.id(), "Third", "9999-12-31 23:59:59");

        List<Reply> firstPage = replyRepository.findPage(post.id(), 2, null);
        Reply boundary = firstPage.get(1);
        List<Reply> secondPage = replyRepository.findPage(
                post.id(),
                2,
                new PostCursor(boundary.createdAt(), boundary.id()));

        assertThat(firstPage).extracting(Reply::id).containsExactly(first.id(), second.id());
        assertThat(secondPage).extracting(Reply::id).containsExactly(third.id());
    }

    private Reply insertAt(long postId, String content, String createdAt) {
        Reply reply = replyRepository.insert(postId, "Tester", content);
        jdbcClient
                .sql("UPDATE replies SET created_at = ? WHERE id = ?")
                .param(createdAt)
                .param(reply.id())
                .update();
        return replyRepository.findById(reply.id()).orElseThrow();
    }
}
