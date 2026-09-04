package com.example.deck.config;

import com.example.deck.service.LocalMediaStorage;
import com.example.deck.service.MediaStorage;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the singleton {@link MediaStorage} adapter from {@code app.media.path},
 * keeping image bytes off the database while staying inside one configured root.
 */
@Configuration
public class MediaStorageConfig {

    @Bean
    public MediaStorage mediaStorage(@Value("${app.media.path:./data/media}") String mediaPath) {
        return new LocalMediaStorage(Path.of(mediaPath));
    }
}