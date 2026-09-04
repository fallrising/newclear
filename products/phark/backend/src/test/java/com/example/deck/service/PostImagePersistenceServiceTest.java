package com.example.deck.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.example.deck.model.Account;
import com.example.deck.model.Post;
import com.example.deck.model.ValidatedImage;
import com.example.deck.repository.AccountRepository;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class PostImagePersistenceServiceTest {

    private static final Path DB_PATH = tempDirectory("deck-t006-db-");
    private static final Path MEDIA_PATH = tempDirectory("deck-t006-media-");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.db.path", () -> DB_PATH.resolve("deck.db").toString());
        registry.add("app.media.path", () -> MEDIA_PATH.toString());
    }

    @Autowired
    private PostImagePersistenceService persistenceService;

    @Autowired
    private AccountRepository accountRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @BeforeEach
    void resetDatabase() {
        jdbcClient.sql("DELETE FROM abuse_signals").update();
        jdbcClient.sql("DELETE FROM post_images").update();
        jdbcClient.sql("DELETE FROM post_likes").update();
        jdbcClient.sql("DELETE FROM post_reposts").update();
        jdbcClient.sql("DELETE FROM replies").update();
        jdbcClient.sql("DELETE FROM notifications").update();
        jdbcClient.sql("DELETE FROM posts").update();
        jdbcClient.sql("DELETE FROM accounts").update();
    }

    @Test
    void createOwnedWithImageCommitsPostAndMetadataAndReturnsProjectionWithImage() throws Exception {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        byte[] bytes = jpeg(1200, 800);

        Post post = persistenceService.createOwnedWithImage(
                alice.id(), "hello image", "home", "t006-key-1", validated(bytes),
                "a".repeat(64));

        assertThat(post.id()).isPositive();
        assertThat(post.content()).isEqualTo("hello image");
        assertThat(post.channel()).isEqualTo("home");
        assertThat(post.image()).isNotNull();
        assertThat(post.image().contentType()).isEqualTo("image/jpeg");
        assertThat(post.image().width()).isEqualTo(1200);
        assertThat(post.image().height()).isEqualTo(800);
        assertThat(post.image().byteSize()).isEqualTo(bytes.length);
        assertThat(post.image().url()).isEqualTo("/api/media/" + post.image().id());
        assertThat(count("posts")).isEqualTo(1);
        assertThat(count("post_images")).isEqualTo(1);
        assertThat(queryLong("SELECT post_id FROM post_images")).isEqualTo(post.id());
        assertThat(queryString("SELECT storage_key FROM post_images")).isEqualTo("t006-key-1");
        assertThat(queryString("SELECT content_type FROM post_images")).isEqualTo("image/jpeg");
        assertThat(queryLong("SELECT byte_size FROM post_images")).isEqualTo(bytes.length);
        assertThat(count("abuse_signals")).isEqualTo(1);
        assertThat(queryLong("SELECT post_id FROM abuse_signals")).isEqualTo(post.id());
    }

    @Test
    void checksumConstraintFailureRollsBackPostInsertAtomically() {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        ValidatedImage invalid = new ValidatedImage(
                "garbage".getBytes(StandardCharsets.UTF_8),
                "image/jpeg",
                "jpg",
                7,
                1,
                1,
                "not-a-sha256");

        assertThatThrownBy(() -> persistenceService.createOwnedWithImage(
                        alice.id(), "hello image", "home", "t006-key-2", invalid,
                        "a".repeat(64)))
                .isInstanceOf(DataAccessException.class);

        assertThat(count("posts")).isZero();
        assertThat(count("post_images")).isZero();
        assertThat(count("abuse_signals")).isZero();
    }

    @Test
    void duplicateStorageKeyFailureRollsBackTheWholeTransactionLeavingNoOrphanPost() throws Exception {
        Account alice = accountRepository.insert("alice", "Alice", "hash");
        byte[] bytes = jpeg(20, 20);
        persistenceService.createOwnedWithImage(
                alice.id(), "first", "home", "t006-dup", validated(bytes),
                "a".repeat(64));

        assertThatThrownBy(() -> persistenceService.createOwnedWithImage(
                        alice.id(), "second", "home", "t006-dup", validated(bytes),
                        "b".repeat(64)))
                .isInstanceOf(DataAccessException.class);

        assertThat(count("posts")).isEqualTo(1);
        assertThat(count("post_images")).isEqualTo(1);
        assertThat(count("abuse_signals")).isEqualTo(1);
        assertThat(queryString("SELECT content FROM posts")).isEqualTo("first");
    }

    private long count(String table) {
        return jdbcClient
                .sql("SELECT COUNT(*) FROM " + table)
                .query(Long.class)
                .single();
    }

    private long queryLong(String sql) {
        return jdbcClient.sql(sql).query(Long.class).single();
    }

    private String queryString(String sql) {
        return jdbcClient.sql(sql).query(String.class).single();
    }

    private static ValidatedImage validated(byte[] bytes) throws Exception {
        return new ValidatedImage(
                bytes, "image/jpeg", "jpg", bytes.length, 1200, 800, sha256Hex(bytes));
    }

    private static Path tempDirectory(String prefix) {
        try {
            return Files.createTempDirectory(prefix);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }

    private static byte[] jpeg(int width, int height) throws Exception {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_3BYTE_BGR);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.dispose();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (!ImageIO.write(image, "jpg", out)) {
            throw new IllegalStateException("No JPEG writer available");
        }
        return out.toByteArray();
    }

    private static String sha256Hex(byte[] data) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
    }
}
