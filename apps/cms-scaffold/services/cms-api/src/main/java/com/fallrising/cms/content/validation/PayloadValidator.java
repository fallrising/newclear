package com.fallrising.cms.content.validation;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.index.EntryIndexer;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.media.service.MediaService;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Validates an entry payload and returns every problem at once (02 B-06, BD-08). Order: reserved keys in payload key
 * order, then fields in fieldsOf order (sortOrder, then key); at most one error per key. A null or blank-string value
 * is "empty": it is only checked for REQUIRED when publish is true, and an empty value clears the field (G-07).
 *
 * <p>Rules for a non-empty value, by field type:
 * string: a JSON string of at most 1,000 code points; markdown: a JSON string of at most 100,000 code points;
 * int: a JSON integer within the long range; boolean: a JSON boolean; datetime: a JSON string that is an ISO-8601
 * instant or offset date-time (EntryIndexer.parseInstant); enum: a JSON string listed in enumValues (any string when
 * enumValues is empty); ref: a lowercase UUID string of an existing entry (deleted entries count) of refTargetTypeKey when set;
 * principal-ref: a lowercase UUID string of an existing principal; media-ref: a UUID string or an object with a UUID mediaId.
 * Other field types are not checked.
 */
public final class PayloadValidator {

    public static final int STRING_MAX = 1_000;
    public static final int MARKDOWN_MAX = 100_000;
    public static final Set<String> RESERVED = Set.of(
            "id", "slug", "contentType", "publicationState", "version", "createdAt", "updatedAt", "publishedAt",
            "deletedAt", "createdBy", "updatedBy", "payload");

    private static final BigInteger LONG_MIN = BigInteger.valueOf(Long.MIN_VALUE);
    private static final BigInteger LONG_MAX = BigInteger.valueOf(Long.MAX_VALUE);

    private final ContentStore content;
    private final IdentityStore identity;

    public PayloadValidator(ContentStore content, IdentityStore identity) {
        this.content = content;
        this.identity = identity;
    }

    public List<FieldError> validate(List<FieldRecord> fields, Map<String, Object> payload, boolean publish) {
        List<FieldError> errors = new ArrayList<>();
        Set<String> reported = new HashSet<>();
        for (String key : payload.keySet()) {
            if (RESERVED.contains(key)) {
                errors.add(error(key, FieldErrorCode.RESERVED_KEY, "Reserved field: " + key));
                reported.add(key);
            }
        }
        for (FieldRecord field : fields) {
            if (reported.contains(field.fieldKey())) continue;
            Object value = payload.get(field.fieldKey());
            if (isEmpty(value)) {
                if (publish && field.required()) {
                    errors.add(error(field.fieldKey(), FieldErrorCode.REQUIRED, "Missing required field " + field.fieldKey()));
                    reported.add(field.fieldKey());
                }
                continue;
            }
            FieldError error = check(field, value);
            if (error != null) {
                errors.add(error);
                reported.add(field.fieldKey());
            }
        }
        return errors;
    }

    /**
     * error.code for a list of field errors: the code of the first error when it is REF_TARGET_NOT_FOUND,
     * REF_TARGET_WRONG_TYPE or PRINCIPAL_REF_UNRESOLVED (the codes v1 returned for that first error), otherwise
     * FIELD_VALIDATION.
     */
    public static ErrorCode topLevelCode(List<FieldError> errors) {
        return switch (errors.getFirst().code()) {
            case REF_TARGET_NOT_FOUND -> ErrorCode.REF_TARGET_NOT_FOUND;
            case REF_TARGET_WRONG_TYPE -> ErrorCode.REF_TARGET_WRONG_TYPE;
            case PRINCIPAL_REF_UNRESOLVED -> ErrorCode.PRINCIPAL_REF_UNRESOLVED;
            default -> ErrorCode.FIELD_VALIDATION;
        };
    }

    private FieldError check(FieldRecord field, Object value) {
        String key = field.fieldKey();
        return switch (field.fieldType()) {
            case "string" -> text(key, value, STRING_MAX);
            case "markdown" -> text(key, value, MARKDOWN_MAX);
            case "int" -> isLongInteger(value) ? null : error(key, FieldErrorCode.WRONG_TYPE, key + " must be an integer");
            case "boolean" -> value instanceof Boolean ? null : error(key, FieldErrorCode.WRONG_TYPE, key + " must be boolean");
            case "datetime" -> {
                if (!(value instanceof String text)) yield error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
                yield EntryIndexer.parseInstant(text) != null ? null
                        : error(key, FieldErrorCode.INVALID_DATETIME, key + " must be an ISO-8601 date-time with offset");
            }
            case "enum" -> {
                if (!(value instanceof String text)) yield error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
                yield field.enumValues() == null || field.enumValues().isEmpty() || field.enumValues().contains(text) ? null
                        : error(key, FieldErrorCode.NOT_IN_ENUM, key + " is not a valid enum value");
            }
            case "ref" -> {
                UUID id = uuid(value);
                if (id == null) yield error(key, FieldErrorCode.INVALID_UUID, key + " must be a UUID");
                EntryRecord target = content.findEntry(id).orElse(null);
                if (target == null) yield error(key, FieldErrorCode.REF_TARGET_NOT_FOUND, "Referenced entry not found");
                yield field.refTargetTypeKey() == null || field.refTargetTypeKey().equals(target.contentTypeKey()) ? null
                        : error(key, FieldErrorCode.REF_TARGET_WRONG_TYPE, "Referenced entry is the wrong type");
            }
            case "principal-ref" -> {
                UUID id = uuid(value);
                if (id == null) yield error(key, FieldErrorCode.INVALID_UUID, key + " must be a UUID");
                yield identity.findPrincipalById(id).isPresent() ? null
                        : error(key, FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found");
            }
            case "media-ref" -> MediaService.parseMediaId(value) != null ? null
                    : error(key, FieldErrorCode.INVALID_UUID, key + " must be a media UUID");
            default -> null;
        };
    }

    private static FieldError text(String key, Object value, int max) {
        if (!(value instanceof String text)) return error(key, FieldErrorCode.WRONG_TYPE, key + " must be a string");
        return text.codePointCount(0, text.length()) <= max ? null
                : error(key, FieldErrorCode.TOO_LONG, key + " must be at most " + max + " characters");
    }

    private static boolean isLongInteger(Object value) {
        if (value instanceof Integer || value instanceof Long || value instanceof Short || value instanceof Byte) return true;
        return value instanceof BigInteger big && big.compareTo(LONG_MIN) >= 0 && big.compareTo(LONG_MAX) <= 0;
    }

    /**
     * The UUID of a string in lowercase canonical 8-4-4-4-12 form, otherwise null.
     * This is the BW1c rule for new writes; existing noncanonical values remain readable.
     */
    private static UUID uuid(Object value) {
        if (!(value instanceof String text)) return null;
        try {
            UUID id = UUID.fromString(text);
            return id.toString().equals(text) ? id : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static FieldError error(String key, FieldErrorCode code, String message) {
        return new FieldError("payload." + key, code, message);
    }

    private static boolean isEmpty(Object value) {
        return value == null || (value instanceof String s && s.isBlank());
    }
}
