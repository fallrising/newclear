package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class StoreContentTypeDirectory implements ContentTypeDirectory {

    private final ContentStore store;

    public StoreContentTypeDirectory(ContentStore store) {
        this.store = store;
    }

    @Override
    public List<String> enabledTypeKeys() {
        return store.listTypes().stream().filter(ContentTypeRecord::enabled).map(ContentTypeRecord::typeKey).sorted().toList();
    }
}
