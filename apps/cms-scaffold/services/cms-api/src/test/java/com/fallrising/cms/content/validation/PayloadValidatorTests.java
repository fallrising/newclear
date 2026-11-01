package com.fallrising.cms.content.validation;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.api.error.FieldError;
import com.fallrising.cms.api.error.FieldErrorCode;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.InMemoryContentStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigInteger;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.Optional;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

class PayloadValidatorTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    InMemoryContentStore content;
    InMemoryIdentityStore identity;
    PayloadValidator validator;
    List<FieldRecord> fields;
    EntryRecord venue;
    EntryRecord page;
    Principal host;
    int nextId;

    UUID nextUuid() {
        return UUID.fromString("abcdefab-cdef-abcd-efab-" + String.format(Locale.ROOT, "%012x", ++nextId));
    }

    @BeforeEach
    void setUp() {
        nextId = 0;
        content = new InMemoryContentStore();
        identity = new InMemoryIdentityStore();
        validator = new PayloadValidator(content, identity);
        UUID type = nextUuid();
        fields = List.of(
                field(type, "title", "string", true, null, List.of(), 0),
                field(type, "body", "markdown", false, null, List.of(), 1),
                field(type, "count", "int", false, null, List.of(), 2),
                field(type, "flag", "boolean", false, null, List.of(), 3),
                field(type, "startsAt", "datetime", false, null, List.of(), 4),
                field(type, "status", "enum", false, null, List.of("open", "closed"), 5),
                field(type, "tag", "enum", false, null, List.of(), 6),
                field(type, "venue", "ref", false, "venue", List.of(), 7),
                field(type, "host", "principal-ref", false, null, List.of(), 8),
                field(type, "cover", "media-ref", false, null, List.of(), 9),
                field(type, "legacy", "date", false, null, List.of(), 10));
        venue = entry("venue");
        page = entry("page");
        host = identity.insertPrincipal(new Principal(nextUuid(), "host", "Host", null, PrincipalStatus.ACTIVE, 0,
                null, null, T0, T0, null));
    }

    FieldRecord field(UUID type, String key, String fieldType, boolean required, String target, List<String> enums, int order) {
        return new FieldRecord(nextUuid(), type, key, fieldType, required, false, false, "public", order, target,
                "restrict", enums, true, false);
    }

    EntryRecord entry(String typeKey) {
        ContentTypeRecord type = new ContentTypeRecord(nextUuid(), typeKey, typeKey, typeKey, null, "title",
                "optional", false, true, true, List.of(), T0, T0);
        content.insertType(type);
        EntryRecord e = new EntryRecord(nextUuid(), type.id(), typeKey, typeKey, PublicationState.DRAFT, 1,
                Map.of(), null, null, null, null, null, null, T0, T0);
        content.insertEntry(e);
        return e;
    }

    static Map<String, Object> payload(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
        return map;
    }

    List<FieldErrorCode> codes(Map<String, Object> payload, boolean publish) {
        return validator.validate(fields, payload, publish).stream().map(FieldError::code).toList();
    }

    @Test
    void B06_validPayloadHasNoErrors() {
        assertThat(validator.validate(fields, payload(
                "title", "Night market", "body", "# Hi", "count", 3, "flag", false,
                "startsAt", "2026-03-01T18:00:00+08:00", "status", "open", "tag", "anything",
                "venue", venue.id().toString(), "host", host.id().toString(),
                "cover", Map.of("mediaId", nextUuid().toString()), "legacy", 20260101, "unknownKey", List.of(1)), true))
                .isEmpty();
    }

    @Test
    void B06_collectsEveryErrorInValidationOrderWithPaths() {
        Map<String, Object> bad = payload(
                "cover", "not-a-uuid", "id", "x", "title", "a".repeat(1_001), "count", 1.5, "flag", "yes",
                "startsAt", "tomorrow", "status", "maybe", "venue", "abc", "host", nextUuid().toString(),
                "version", 3);
        assertThat(validator.validate(fields, bad, false)).containsExactly(
                new FieldError("payload.id", FieldErrorCode.RESERVED_KEY, "Reserved field: id"),
                new FieldError("payload.version", FieldErrorCode.RESERVED_KEY, "Reserved field: version"),
                new FieldError("payload.title", FieldErrorCode.TOO_LONG, "title must be at most 1000 characters"),
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "count must be an integer"),
                new FieldError("payload.flag", FieldErrorCode.WRONG_TYPE, "flag must be boolean"),
                new FieldError("payload.startsAt", FieldErrorCode.INVALID_DATETIME, "startsAt must be an ISO-8601 date-time with offset"),
                new FieldError("payload.status", FieldErrorCode.NOT_IN_ENUM, "status is not a valid enum value"),
                new FieldError("payload.venue", FieldErrorCode.INVALID_UUID, "venue must be a UUID"),
                new FieldError("payload.host", FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "Principal not found"),
                new FieldError("payload.cover", FieldErrorCode.INVALID_UUID, "cover must be a media UUID"));
    }

    @Test
    void B06_lengthLimitsCountCodePoints() {
        String emoji = "😀";
        assertThat(codes(payload("title", emoji.repeat(1_000)), false)).isEmpty();
        assertThat(codes(payload("title", emoji.repeat(1_001)), false)).containsExactly(FieldErrorCode.TOO_LONG);
        assertThat(codes(payload("body", "b".repeat(100_000)), false)).isEmpty();
        assertThat(codes(payload("body", "b".repeat(100_001)), false)).containsExactly(FieldErrorCode.TOO_LONG);
        assertThat(codes(payload("title", 5, "body", true), false)).containsExactly(FieldErrorCode.WRONG_TYPE, FieldErrorCode.WRONG_TYPE);
    }

    @Test
    void B06_numbersBooleansDatetimesAndEnumsCheckJsonTypes() {
        assertThat(codes(payload("count", Long.MAX_VALUE), false)).isEmpty();
        assertThat(codes(payload("count", BigInteger.valueOf(Long.MAX_VALUE)), false)).isEmpty();
        assertThat(codes(payload("count", BigInteger.valueOf(Long.MAX_VALUE).add(BigInteger.ONE)), false))
                .containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("count", "3"), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("flag", "true"), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("startsAt", "2026-01-01T00:00:00Z"), false)).isEmpty();
        assertThat(codes(payload("startsAt", "2026-01-01"), false)).containsExactly(FieldErrorCode.INVALID_DATETIME);
        assertThat(codes(payload("startsAt", 1_700_000_000), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("status", 1), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
        assertThat(codes(payload("status", "Open"), false)).containsExactly(FieldErrorCode.NOT_IN_ENUM);
    }

    @Test
    void B06_referencesMustResolve() {
        assertThat(codes(payload("venue", venue.id().toString()), false)).isEmpty();
        assertThat(codes(payload("venue", venue.id().toString().toUpperCase(Locale.ROOT)), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("venue", page.id().toString()), false)).containsExactly(FieldErrorCode.REF_TARGET_WRONG_TYPE);
        assertThat(codes(payload("venue", nextUuid().toString()), false)).containsExactly(FieldErrorCode.REF_TARGET_NOT_FOUND);
        assertThat(codes(payload("venue", 7), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("host", "abc"), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("cover", Map.of("mediaId", "x")), false)).containsExactly(FieldErrorCode.INVALID_UUID);
    }

    @Test
    void B06_emptyValuesAreOnlyCheckedForRequiredOnPublish() {
        assertThat(codes(payload("title", null, "count", "", "startsAt", "  "), false)).isEmpty();
        assertThat(codes(payload("count", ""), true)).containsExactly(FieldErrorCode.REQUIRED);
        assertThat(validator.validate(fields, payload("title", " "), true))
                .containsExactly(new FieldError("payload.title", FieldErrorCode.REQUIRED, "Missing required field title"));
    }

    @Test
    void B06_topLevelCodeFollowsTheFirstError() {
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_NOT_FOUND, "m"),
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "m")))).isEqualTo(ErrorCode.REF_TARGET_NOT_FOUND);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_WRONG_TYPE, "m")))).isEqualTo(ErrorCode.REF_TARGET_WRONG_TYPE);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.host", FieldErrorCode.PRINCIPAL_REF_UNRESOLVED, "m")))).isEqualTo(ErrorCode.PRINCIPAL_REF_UNRESOLVED);
        assertThat(PayloadValidator.topLevelCode(List.of(
                new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "m"),
                new FieldError("payload.venue", FieldErrorCode.REF_TARGET_NOT_FOUND, "m")))).isEqualTo(ErrorCode.FIELD_VALIDATION);
    }

    @Test
    void B06_reservedMetadataNeverDuplicatesAnErrorForTheSameKey() {
        UUID type = nextUuid();
        List<FieldRecord> metadata = List.of(
                field(type, "id", "int", true, null, List.of(), 0),
                field(type, "version", "int", true, null, List.of(), 1),
                field(type, "count", "int", false, null, List.of(), 2),
                field(type, "count", "boolean", false, null, List.of(), 3));
        assertThat(validator.validate(metadata, payload("version", null, "count", "bad", "id", "bad"), true))
                .containsExactly(
                        new FieldError("payload.version", FieldErrorCode.RESERVED_KEY, "Reserved field: version"),
                        new FieldError("payload.id", FieldErrorCode.RESERVED_KEY, "Reserved field: id"),
                        new FieldError("payload.count", FieldErrorCode.WRONG_TYPE, "count must be an integer"));
    }

    @Test
    void B06_integerBoundariesRejectDecimalsAndCoercion() {
        for (Object valid : List.of(Long.MIN_VALUE, Long.MAX_VALUE, BigInteger.valueOf(Long.MIN_VALUE),
                BigInteger.valueOf(Long.MAX_VALUE), 0, (short) 1, (byte) 1)) {
            assertThat(codes(payload("count", valid), false)).as("valid integer %s (%s)", valid, valid.getClass()).isEmpty();
        }
        for (Object invalid : List.of(BigInteger.valueOf(Long.MIN_VALUE).subtract(BigInteger.ONE),
                BigInteger.valueOf(Long.MAX_VALUE).add(BigInteger.ONE), 1.5, 1.0, 1.0f,
                new BigDecimal("1"), new BigDecimal("1.5"), Double.NaN, Double.POSITIVE_INFINITY, "1", true)) {
            assertThat(codes(payload("count", invalid), false)).as("invalid integer %s (%s)", invalid, invalid.getClass())
                    .containsExactly(FieldErrorCode.WRONG_TYPE);
        }
    }

    @Test
    void B06_datetimeRequiresAnOffsetAndEnumNeverCoercesJsonValues() {
        for (String valid : List.of("2026-01-01T00:00:00Z", "2026-01-01T00:00:00.123456789Z",
                "2026-01-01T12:00:00+05:30", "2026-01-01T12:00:00-04:00")) {
            assertThat(codes(payload("startsAt", valid), false)).as("valid date-time %s", valid).isEmpty();
        }
        for (String invalid : List.of("2026-01-01", "2026-01-01T12:00:00", "tomorrow",
                "2026-13-01T00:00:00Z", "2026-01-01T00:00:00+25:00")) {
            assertThat(codes(payload("startsAt", invalid), false)).as("invalid date-time %s", invalid)
                    .containsExactly(FieldErrorCode.INVALID_DATETIME);
        }
        for (Object invalid : List.of(1, true, List.of("open"), Map.of("value", "open"))) {
            assertThat(codes(payload("status", invalid, "tag", invalid), false))
                    .containsExactly(FieldErrorCode.WRONG_TYPE, FieldErrorCode.WRONG_TYPE);
        }
        assertThat(codes(payload("flag", false, "tag", "unlisted"), false)).isEmpty();
        assertThat(codes(payload("flag", 0), false)).containsExactly(FieldErrorCode.WRONG_TYPE);
    }

    @Test
    void B06_uuidRulesAreCanonicalForEntriesAndPrincipalsButPreserveMediaParsing() {
        assertThat(codes(payload("host", host.id().toString()), false)).isEmpty();
        assertThat(codes(payload("host", host.id().toString().toUpperCase(Locale.ROOT)), false))
                .containsExactly(FieldErrorCode.INVALID_UUID);
        for (Object invalid : List.of("1-1-1-1-1", " " + venue.id(), venue.id(), 7, Map.of("id", venue.id().toString()))) {
            assertThat(codes(payload("venue", invalid, "host", invalid), false))
                    .containsExactly(FieldErrorCode.INVALID_UUID, FieldErrorCode.INVALID_UUID);
        }
        String absentMedia = nextUuid().toString().toUpperCase(Locale.ROOT);
        assertThat(codes(payload("cover", absentMedia), false)).isEmpty();
        assertThat(codes(payload("cover", Map.of("mediaId", absentMedia)), false)).isEmpty();
        assertThat(codes(payload("cover", Map.of("id", absentMedia)), false)).containsExactly(FieldErrorCode.INVALID_UUID);
        assertThat(codes(payload("host", nextUuid().toString()), false)).containsExactly(FieldErrorCode.PRINCIPAL_REF_UNRESOLVED);
    }

    @Test
    void B06_softDeletedReferencesStillResolveAndUntypedReferencesAcceptOtherTypes() {
        EntryRecord deleted = new EntryRecord(nextUuid(), venue.contentTypeId(), "venue", "deleted", PublicationState.DRAFT,
                1, Map.of(), null, null, null, T0, null, null, T0, T0);
        content.insertEntry(deleted);
        assertThat(codes(payload("venue", deleted.id().toString()), false)).isEmpty();
        FieldRecord anyRef = field(nextUuid(), "any", "ref", false, null, List.of(), 0);
        assertThat(validator.validate(List.of(anyRef), payload("any", page.id().toString()), false)).isEmpty();
    }

    @Test
    void B06_allReservedKeysAreRejectedIncludingNullValuesInPayloadOrder() {
        List<String> keys = List.of("payload", "updatedBy", "createdBy", "deletedAt", "publishedAt", "updatedAt",
                "createdAt", "version", "publicationState", "contentType", "slug", "id");
        Map<String, Object> body = new LinkedHashMap<>();
        keys.forEach(key -> body.put(key, null));
        assertThat(validator.validate(List.of(), body, false)).containsExactlyElementsOf(keys.stream()
                .map(key -> new FieldError("payload." + key, FieldErrorCode.RESERVED_KEY, "Reserved field: " + key)).toList());
    }

    @Test
    void B06_emptyValuesSkipAllTypeAndReferenceChecksUntilRequiredPublish() {
        for (Object empty : new Object[] {null, "", " \t\n"}) {
            Map<String, Object> body = new LinkedHashMap<>();
            fields.forEach(field -> body.put(field.fieldKey(), empty));
            assertThat(validator.validate(fields, body, false)).isEmpty();
            assertThat(validator.validate(fields, body, true)).containsExactly(
                    new FieldError("payload.title", FieldErrorCode.REQUIRED, "Missing required field title"));
        }
        assertThat(validator.validate(List.of(), payload("unknown", Map.of("any", "value")), true)).isEmpty();
        FieldRecord disabled = new FieldRecord(nextUuid(), nextUuid(), "disabled", "int", false,
                false, false, "public", 0, null, "restrict", List.of(), false, false);
        assertThat(validator.validate(List.of(disabled), payload("disabled", 1.5), false)).containsExactly(
                new FieldError("payload.disabled", FieldErrorCode.WRONG_TYPE, "disabled must be an integer"));
    }

    @Test
    void B06_validReferencesReadEachTargetOnceAndInvalidOrEmptyReferencesNeverReadStores() {
        var contentLookup = mock(com.fallrising.cms.content.store.ContentStore.class);
        var identityLookup = mock(com.fallrising.cms.identity.store.IdentityStore.class);
        when(contentLookup.findEntry(venue.id())).thenReturn(Optional.of(venue));
        when(identityLookup.findPrincipalById(host.id())).thenReturn(Optional.of(host));
        PayloadValidator checked = new PayloadValidator(contentLookup, identityLookup);
        assertThat(checked.validate(fields, payload("venue", venue.id().toString(), "host", host.id().toString()), false))
                .isEmpty();
        verify(contentLookup).findEntry(venue.id());
        verify(identityLookup).findPrincipalById(host.id());
        verifyNoMoreInteractions(contentLookup, identityLookup);
        clearInvocations(contentLookup, identityLookup);
        assertThat(checked.validate(fields, payload("venue", "bad", "host", "bad"), false))
                .extracting(FieldError::code).containsExactly(FieldErrorCode.INVALID_UUID, FieldErrorCode.INVALID_UUID);
        assertThat(checked.validate(fields, payload("venue", null, "host", " "), false)).isEmpty();
        verifyNoInteractions(contentLookup, identityLookup);
    }
}
