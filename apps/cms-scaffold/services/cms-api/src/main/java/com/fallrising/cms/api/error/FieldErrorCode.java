package com.fallrising.cms.api.error;

/** error.fields[].code. The wire value must match components.schemas.FieldErrorCode in openapi.yaml. */
public enum FieldErrorCode {
    REQUIRED,
    RESERVED_KEY,
    WRONG_TYPE,
    TOO_LONG,
    INVALID_DATETIME,
    NOT_IN_ENUM,
    INVALID_UUID,
    REF_TARGET_NOT_FOUND,
    REF_TARGET_WRONG_TYPE,
    PRINCIPAL_REF_UNRESOLVED,
    INVALID_FORMAT,
    DUPLICATE;

    public String wire() {
        return name();
    }
}
