package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;

class InMemoryIdentityStoreContractTests extends IdentityStoreContract {

    @Override
    protected IdentityStore newStore() {
        return new InMemoryIdentityStore();
    }
}
