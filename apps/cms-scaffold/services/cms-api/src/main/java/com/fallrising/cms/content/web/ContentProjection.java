package com.fallrising.cms.content.web;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.service.EntryService;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class ContentProjection {

    private ContentProjection() {}

    /** Work copy. title is payload[type.titleField] (G-11); type is null only when the type row is missing. */
    static Map<String, Object> work(EntryRecord entry, ContentTypeRecord type) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", entry.id().toString());
        json.put("contentType", entry.contentTypeKey());
        json.put("slug", entry.slug());
        json.put("publicationState", entry.publicationState().wire());
        json.put("version", entry.version());
        json.put("title", title(entry.payload(), type == null ? null : type.titleField()));
        json.put("payload", entry.payloadCopy());
        json.put("dirty", entry.dirty());
        json.put("publishRequestedAt", entry.publishRequestedAt());
        json.put("publishRequestedBy", entry.publishRequestedBy() == null ? null : entry.publishRequestedBy().toString());
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
                if (value != null && "media-ref".equals(field.fieldType()) && mediaExpander != null) {
                    Object expanded = mediaExpander.apply(value);
                    payload.put(field.fieldKey(), expanded);
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

    /**
     * Type schema for Back and Admin (02 §4.7). admin=true adds enabled, and per field indexed and enabled,
     * and includes internal and disabled fields; admin=false omits internal and disabled fields.
     */
    static Map<String, Object> typeSchema(ContentTypeRecord type, List<FieldRecord> fields, boolean admin) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", type.typeKey());
        json.put("displayName", type.displayName());
        json.put("pluralDisplayName", type.pluralDisplayName());
        json.put("titleField", type.titleField());
        json.put("sortField", type.sortField());
        json.put("visibilityField", type.visibilityField());
        json.put("ownerField", type.ownerField());
        json.put("slugPolicy", type.slugPolicy());
        json.put("singleton", type.singleton());
        json.put("previewable", type.previewable());
        if (admin) {
            json.put("enabled", type.enabled());
        }
        json.put("fields", fields.stream()
                .filter(f -> admin || (f.enabled() && !"internal".equals(f.visibility())))
                .map(f -> fieldSchema(f, admin))
                .toList());
        return json;
    }

    static Map<String, Object> fieldSchema(FieldRecord field, boolean admin) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", field.fieldKey());
        json.put("type", field.fieldType());
        json.put("label", field.label());
        json.put("helpText", field.helpText());
        json.put("required", field.required());
        json.put("group", field.groupKey());
        json.put("order", field.sortOrder());
        json.put("listable", field.listable());
        json.put("filterable", field.filterable());
        json.put("enumValues", field.enumValues());
        json.put("enumLabels", field.enumLabels());
        json.put("refTarget", field.refTargetTypeKey());
        json.put("placeholder", field.placeholder());
        json.put("visibility", field.visibility());
        if (admin) {
            json.put("indexed", field.indexed());
            json.put("enabled", field.enabled());
        }
        return json;
    }

    static Object title(Map<String, Object> payload, String titleField) {
        if (payload == null || titleField == null) {
            return null;
        }
        return payload.get(titleField);
    }

    /** List response (02 §4.1): page and size, plus offset and limit kept for v1 clients. */
    static Map<String, Object> page(List<Map<String, Object>> items, EntryService.ListResult result) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("items", items);
        json.put("total", result.page().total());
        json.put("page", result.pageNo());
        json.put("size", result.size());
        json.put("offset", (result.pageNo() - 1L) * result.size());
        json.put("limit", result.size());
        return json;
    }
}
