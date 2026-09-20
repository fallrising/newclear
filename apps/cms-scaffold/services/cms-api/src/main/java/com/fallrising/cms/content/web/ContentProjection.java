package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class ContentProjection {

    private ContentProjection() {}

    static Map<String, Object> work(EntryRecord entry) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", entry.id().toString());
        json.put("contentType", entry.contentTypeKey());
        json.put("slug", entry.slug());
        json.put("publicationState", entry.publicationState().wire());
        json.put("version", entry.version());
        json.put("title", title(entry.payload(), "title"));
        json.put("payload", entry.payloadCopy());
        json.put("dirty", entry.dirty());
        json.put("publishedAt", entry.publishedAt());
        json.put("updatedAt", entry.updatedAt());
        return json;
    }

    static Map<String, Object> published(
            EntryRecord entry,
            ContentTypeRecord type,
            List<FieldRecord> fields,
            java.util.function.Function<Object, Object> mediaExpander) {
        Map<String, Object> payload = new LinkedHashMap<>();
        Map<String, Object> source = entry.publishedPayload() == null ? Map.of() : entry.publishedPayload();
        for (FieldRecord field : fields) {
            if (field.enabled() && "public".equals(field.visibility()) && source.containsKey(field.fieldKey())) {
                Object value = source.get(field.fieldKey());
                if ("media-ref".equals(field.fieldType()) && mediaExpander != null) {
                    Object expanded = mediaExpander.apply(value);
                    payload.put(field.fieldKey(), expanded == null ? value : expanded);
                } else {
                    payload.put(field.fieldKey(), value);
                }
            }
        }
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", entry.id().toString());
        json.put("contentType", entry.contentTypeKey());
        json.put("slug", entry.slug());
        json.put("title", title(source, type.titleField()));
        json.put("payload", payload);
        json.put("publishedAt", entry.publishedAt());
        return json;
    }

    static Object title(Map<String, Object> payload, String titleField) {
        if (payload == null || titleField == null) {
            return null;
        }
        return payload.get(titleField);
    }
}
