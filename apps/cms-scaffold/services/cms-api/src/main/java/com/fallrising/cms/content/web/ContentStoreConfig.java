package com.fallrising.cms.content.web;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

@Configuration
public class ContentStoreConfig {

    /** Resolve after auto-configuration; tests without a DataSource retain the in-memory store. */
    @Bean
    ContentStore contentStore(ObjectProvider<DataSource> dataSource, ObjectMapper objectMapper) {
        DataSource ds = dataSource.getIfAvailable();
        return ds != null ? new JdbcContentStore(ds, objectMapper) : new InMemoryContentStore();
    }
}
