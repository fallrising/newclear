package com.fallrising.cms.content.index;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * One row of cms_entry_index. Exactly one of the value components is non-null, chosen by kind:
 * string, enum and ref use stringValue; int uses intValue; bool uses boolValue; datetime uses tsValue.
 */
public record IndexRow(
        UUID entryId,
        String fieldKey,
        IndexScope scope,
        String kind,
        String stringValue,
        BigDecimal intValue,
        Boolean boolValue,
        Instant tsValue) {

    public IndexRow {
        if (intValue != null) intValue = intValue.stripTrailingZeros();
    }

    /** Numeric callers share the same exact decimal representation as JSON and PostgreSQL. */
    public IndexRow(UUID entryId, String fieldKey, IndexScope scope, String kind, String stringValue,
            Number intValue, Boolean boolValue, Instant tsValue) {
        this(entryId, fieldKey, scope, kind, stringValue,
                intValue == null ? null : new BigDecimal(intValue.toString()), boolValue, tsValue);
    }
}
