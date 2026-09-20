package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;

@Configuration
public class IdentityStoreConfig {

    @Bean
    @ConditionalOnBean({DataSource.class, PlatformTransactionManager.class})
    IdentityStore jdbcIdentityStore(DataSource dataSource, PlatformTransactionManager transactionManager) {
        return new JdbcIdentityStore(dataSource, new TransactionTemplate(transactionManager));
    }

    @Bean
    @ConditionalOnMissingBean(IdentityStore.class)
    IdentityStore inMemoryIdentityStore() {
        return new InMemoryIdentityStore();
    }
}
