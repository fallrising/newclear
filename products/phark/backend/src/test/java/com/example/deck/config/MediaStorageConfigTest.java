package com.example.deck.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.deck.service.MediaStorage;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest
class MediaStorageConfigTest {

    private static final Path MEDIA_ROOT = tempDirectory("deck-t006-config-media-");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("app.media.path", () -> MEDIA_ROOT.toString());
    }

    @Autowired
    private MediaStorage mediaStorage;

    @Autowired
    private ApplicationContext applicationContext;

    @Test
    void mediaStorageBeanStoresReadsAndDeletesWithinConfiguredRoot() throws Exception {
        byte[] bytes = "media bytes".getBytes(StandardCharsets.UTF_8);

        String key = mediaStorage.store(bytes, "png");

        assertThat(key).endsWith(".png");
        Path stored = MEDIA_ROOT.resolve(key);
        assertThat(stored.normalize().startsWith(MEDIA_ROOT.normalize())).isTrue();
        assertThat(Files.readAllBytes(stored)).isEqualTo(bytes);
        assertThat(mediaStorage.read(key)).isEqualTo(bytes);

        mediaStorage.delete(key);

        assertThat(Files.exists(stored)).isFalse();
    }

    @Test
    void mediaStorageIsASingletonBeanInTheContainer() {
        assertThat(applicationContext.getBean(MediaStorage.class)).isSameAs(mediaStorage);
    }

    private static Path tempDirectory(String prefix) {
        try {
            return Files.createTempDirectory(prefix);
        } catch (IOException exception) {
            throw new UncheckedIOException(exception);
        }
    }
}