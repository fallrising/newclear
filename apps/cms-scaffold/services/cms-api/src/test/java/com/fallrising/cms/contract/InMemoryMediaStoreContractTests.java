package com.fallrising.cms.contract;

import com.fallrising.cms.media.store.InMemoryMediaStore;
import com.fallrising.cms.media.store.MediaStore;

class InMemoryMediaStoreContractTests extends MediaStoreContract {

    @Override
    protected MediaStore newStore() {
        return new InMemoryMediaStore();
    }
}
