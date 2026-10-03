package com.fallrising.cms.contract;

import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.content.store.InMemoryContentStore;

class InMemoryContentStoreContractTests extends ContentStoreContract {

    @Override
    protected ContentStore newStore() {
        return new InMemoryContentStore();
    }
}
