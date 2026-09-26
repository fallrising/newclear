package com.fallrising.cms.contract;

import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaStore;

class JdbcMediaStoreContractTests extends MediaStoreContract {

    @Override
    protected MediaStore newStore() {
        return new JdbcMediaStore(PostgresFixture.cleanDataSource());
    }
}
