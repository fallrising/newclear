package com.fallrising.cms.content.domain;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A field of a content type. The last seven components are display metadata (02 BD-06): label, groupKey,
 * listable, filterable, enumLabels (enum value to display name; never null), placeholder, helpText.
 */
public record FieldRecord(
        UUID id,
        UUID contentTypeId,
        String fieldKey,
        String fieldType,
        boolean required,
        boolean uniqueInType,
        boolean indexed,
        String visibility,
        int sortOrder,
        String refTargetTypeKey,
        String onDelete,
        List<String> enumValues,
        boolean enabled,
        boolean publicBytes,
        String label,
        String groupKey,
        boolean listable,
        boolean filterable,
        Map<String, String> enumLabels,
        String placeholder,
        String helpText) {

    public FieldRecord {
        enumLabels = enumLabels == null ? Map.of() : Map.copyOf(enumLabels);
    }

    /** Field without display metadata. */
    public FieldRecord(
            UUID id,
            UUID contentTypeId,
            String fieldKey,
            String fieldType,
            boolean required,
            boolean uniqueInType,
            boolean indexed,
            String visibility,
            int sortOrder,
            String refTargetTypeKey,
            String onDelete,
            List<String> enumValues,
            boolean enabled,
            boolean publicBytes) {
        this(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility, sortOrder,
                refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, null, null, false, false, Map.of(), null, null);
    }

    public FieldRecord withPublicBytes(boolean publicBytes) {
        return new FieldRecord(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility,
                sortOrder, refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, label, groupKey, listable,
                filterable, enumLabels, placeholder, helpText);
    }

    public FieldRecord withMetadata(String label, String groupKey, boolean listable, boolean filterable,
            Map<String, String> enumLabels, String placeholder, String helpText) {
        return new FieldRecord(id, contentTypeId, fieldKey, fieldType, required, uniqueInType, indexed, visibility,
                sortOrder, refTargetTypeKey, onDelete, enumValues, enabled, publicBytes, label, groupKey, listable,
                filterable, enumLabels, placeholder, helpText);
    }
}
