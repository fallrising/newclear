package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;

class JdbcIdentityStoreContractTests extends IdentityStoreContract {

    @Override
    protected IdentityStore newStore() {
        DataSource dataSource = PostgresFixture.cleanDataSource();
        return new JdbcIdentityStore(dataSource, new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
    }
}
