package com.fallrising.cms.content.web;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

@Configuration
public class ContentStoreConfig {

    @Bean
    @ConditionalOnBean(DataSource.class)
    ContentStore jdbcContentStore(DataSource dataSource, ObjectMapper objectMapper) {
        return new JdbcContentStore(dataSource, objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean(ContentStore.class)
    ContentStore inMemoryContentStore() {
        return new InMemoryContentStore();
    }
}
