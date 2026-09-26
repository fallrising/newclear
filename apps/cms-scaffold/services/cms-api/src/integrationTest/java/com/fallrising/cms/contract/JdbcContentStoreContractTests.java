package com.fallrising.cms.contract;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fasterxml.jackson.databind.ObjectMapper;

class JdbcContentStoreContractTests extends ContentStoreContract {

    @Override
    protected ContentStore newStore() {
        return new JdbcContentStore(PostgresFixture.cleanDataSource(), new ObjectMapper());
    }
}
