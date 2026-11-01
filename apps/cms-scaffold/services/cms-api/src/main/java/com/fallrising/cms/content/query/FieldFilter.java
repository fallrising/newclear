package com.fallrising.cms.content.query;

import java.time.Instant;

/**
 * A condition on the index rows of one field. EQUALS compares by the field's index kind (value is String for
 * string/enum/ref, Long for int, Boolean for bool). RANGE applies to datetime: from inclusive, to exclusive,
 * either bound may be null.
 */
public record FieldFilter(String fieldKey, String kind, Op op, Object value, Instant from, Instant to) {

    public enum Op { EQUALS, RANGE }

    public static FieldFilter equalsValue(String fieldKey, String kind, Object value) {
        return new FieldFilter(fieldKey, kind, Op.EQUALS, value, null, null);
    }

    public static FieldFilter range(String fieldKey, Instant from, Instant to) {
        return new FieldFilter(fieldKey, "datetime", Op.RANGE, null, from, to);
    }
}
