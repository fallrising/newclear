package com.fallrising.cms.content.domain;

import java.util.List;
import java.util.UUID;

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
        boolean publicBytes) {}
