package com.fallrising.cms.media.web;

import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.LocalDiskMediaObjectStore;
import com.fallrising.cms.media.store.MediaObjectStore;
import com.fallrising.cms.media.store.MediaStore;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.ObjectProvider;
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

    /** Resolve after auto-configuration; tests without a DataSource retain the in-memory store. */
    @Bean
    MediaStore mediaStore(ObjectProvider<DataSource> dataSource) {
        DataSource ds = dataSource.getIfAvailable();
        return ds != null ? new JdbcMediaStore(ds) : new InMemoryMediaStore();
    }
}
