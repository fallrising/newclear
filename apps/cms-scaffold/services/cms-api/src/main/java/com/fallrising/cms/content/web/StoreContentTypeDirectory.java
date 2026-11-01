package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Set;

@Component
public class StoreContentTypeDirectory implements ContentTypeDirectory {

    private static final Set<String> PREDICATE_FIELD_TYPES = Set.of("string", "enum", "ref", "principal-ref");

    private final ContentStore store;

    public StoreContentTypeDirectory(ContentStore store) {
        this.store = store;
    }

    @Override
    public List<String> enabledTypeKeys() {
        return store.listTypes().stream().filter(ContentTypeRecord::enabled).map(ContentTypeRecord::typeKey).sorted().toList();
    }

    @Override
    public boolean predicateFieldCompilable(String typeKey, String fieldKey) {
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElse(null);
        if (type == null) return false;
        List<FieldRecord> fields = store.fieldsOf(type.id());
        if (!EntryIndexer.indexedKeys(type, fields).contains(fieldKey)) return false;
        return fields.stream().anyMatch(f -> f.fieldKey().equals(fieldKey) && PREDICATE_FIELD_TYPES.contains(f.fieldType()));
    }
}
