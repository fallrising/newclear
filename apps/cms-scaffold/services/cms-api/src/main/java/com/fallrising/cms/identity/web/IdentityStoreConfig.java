package com.fallrising.cms.identity.web;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;

@Configuration
public class IdentityStoreConfig {

    /** Resolve after auto-configuration; tests without a DataSource retain the in-memory store. */
    @Bean
    IdentityStore identityStore(ObjectProvider<DataSource> dataSource,
            ObjectProvider<PlatformTransactionManager> transactionManager) {
        DataSource ds = dataSource.getIfAvailable();
        PlatformTransactionManager tm = transactionManager.getIfAvailable();
        return ds != null && tm != null ? new JdbcIdentityStore(ds, new TransactionTemplate(tm)) : new InMemoryIdentityStore();
    }
}
