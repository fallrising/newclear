package com.fallrising.cms.media.web;

import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.LocalDiskMediaObjectStore;
import com.fallrising.cms.media.store.MediaObjectStore;
import com.fallrising.cms.media.store.MediaStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;
import java.nio.file.Path;

@Configuration
public class MediaStoreConfig {

    @Bean
    MediaObjectStore mediaObjectStore(@Value("${cms.media.root:./data/media}") String root) {
        return new LocalDiskMediaObjectStore(Path.of(root));
    }

    @Bean
    @ConditionalOnBean(DataSource.class)
    MediaStore jdbcMediaStore(DataSource dataSource) {
        return new JdbcMediaStore(dataSource);
    }

    @Bean
    @ConditionalOnMissingBean(MediaStore.class)
    MediaStore inMemoryMediaStore() {
        return new InMemoryMediaStore();
    }
}
