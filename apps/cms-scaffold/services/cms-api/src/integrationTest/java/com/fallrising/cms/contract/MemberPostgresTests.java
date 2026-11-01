package com.fallrising.cms.contract;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.service.ContentTypeSeed;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.service.MeRateLimiter;
import com.fallrising.cms.content.service.MeService;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.service.SeedService;
import com.fallrising.cms.identity.service.DemoSeedPolicy;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.service.MediaService;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real PostgreSQL member writes use seeded authorization and the existing entry transaction. */
class MemberPostgresTests {
    private final ObjectMapper mapper = new ObjectMapper();
    private JdbcTemplate jdbc;
    private JdbcContentStore content;
    private JdbcIdentityStore identity;
    private JdbcMediaStore media;
    private AuthorizationService authorization;
    private SeedService identitySeed;
    private ContentTypeSeed contentSeed;
    private ContentTypeRecord requests;
    private Principal owner;
    private Principal other;
    private EntryRecord pet;
    private MeService me;
    private AtomicBoolean failAudit;
    private AtomicReference<UUID> attemptedEntry;
    private UUID faultMedia;

    @BeforeEach
    void setUp() {
        var source = PostgresFixture.cleanDataSource();
        jdbc = new JdbcTemplate(source);
        content = new JdbcContentStore(source, mapper);
        identity = new JdbcIdentityStore(source, null);
        media = new JdbcMediaStore(source);
        authorization = new AuthorizationService(identity, mapper, new TransactionRunner(source));
        IdentityProperties properties = new IdentityProperties();
        properties.setSeedPassword("unused-test-password");
        PasswordHasher hasher = mock(PasswordHasher.class);
        when(hasher.hash(anyString())).thenReturn("unused-test-hash");
        when(hasher.algo()).thenReturn("argon2id");
        var demoPolicy = new DemoSeedPolicy(properties, new MockEnvironment());
        identitySeed = new SeedService(identity, hasher, properties, demoPolicy);
        identitySeed.seed();
        contentSeed = new ContentTypeSeed(content, demoPolicy);
        contentSeed.seed();
        requests = content.findTypeByKey("appointment_request").orElseThrow();
        owner = identity.findPrincipalByUsername("seed-member-clinic").orElseThrow();
        other = identity.findPrincipalByUsername("seed-member-projects").orElseThrow();
        pet = pet(owner, "My pet");
        failAudit = new AtomicBoolean();
        attemptedEntry = new AtomicReference<>();
        AuditLog audit = new AuditLog(identity, mapper) {
            @Override public void record(Principal actor, Surface surface, String category, String action,
                    String targetType, UUID targetId, String outcome, Map<String, Object> detail) {
                super.record(actor, surface, category, action, targetType, targetId, outcome, detail);
                if (failAudit.get()) {
                    attemptedEntry.set(targetId);
                    // Prove injection occurs after the actual dependent writes and actual audit insert.
                    assertThat(content.findEntry(targetId)).isPresent();
                    assertThat(content.indexRowsOf(targetId)).isNotEmpty();
                    assertThat(content.refsTo(pet.id())).anySatisfy(ref -> assertThat(ref.fromEntryId()).isEqualTo(targetId));
                    assertThat(media.attachmentsOfMedia(faultMedia)).anySatisfy(attachment -> assertThat(attachment.entryId()).isEqualTo(targetId));
                    assertThat(identity.listAudits("entry.create", targetId)).hasSize(1);
                    throw new IllegalStateException("injected audit failure after insert");
                }
            }
        };
        EntryService entries = new EntryService(content, authorization, identity,
                new MediaService(media, null, content, authorization), audit);
        me = new MeService(content, entries, authorization, new MeRateLimiter());
    }

    @Test
    void appointmentSeedsAreIdempotentAndMemberCreateIsFrontOnly() {
        assertThat(requests.titleField()).isEqualTo("reason");
        assertThat(requests.slugPolicy()).isEqualTo("none");
        assertThat(requests.ownerField()).isEqualTo("ownerPrincipalId");
        assertThat(requests.singleton()).isFalse();
        var fields = content.fieldsOf(requests.id());
        assertThat(fields).extracting(FieldRecord::fieldKey).containsExactly("pet", "preferredAt", "reason", "ownerPrincipalId");
        assertThat(fields).filteredOn(FieldRecord::required).extracting(FieldRecord::fieldKey).containsExactly("pet", "preferredAt", "reason");
        assertThat(fields).allSatisfy(field -> assertThat(field.label()).isNotBlank());
        var memberRole = identity.findRoleByCode("member").orElseThrow();
        var grants = identity.permissionsOfRole(memberRole.id());
        assertThat(grants).filteredOn(permission -> permission.action().equals("create"))
                .singleElement().satisfies(permission -> {
                    assertThat(permission.contentTypeCode()).isEqualTo("appointment_request");
                    assertThat(permission.allowedSurfaces()).containsExactly("front");
                    assertThat(permission.predicateJson()).isNull();
                });
        assertThat(authorization.hasAction(owner, CmsAction.CREATE, requests.typeKey(), Surface.FRONT)).isTrue();
        assertThat(authorization.hasAction(owner, CmsAction.CREATE, requests.typeKey(), Surface.BACK)).isFalse();
        assertThat(authorization.hasAction(owner, CmsAction.CREATE, requests.typeKey(), Surface.ADMIN)).isFalse();
        contentSeed.seed();
        identitySeed.seed();
        assertThat(content.fieldsOf(requests.id())).containsExactlyElementsOf(fields);
        assertThat(identity.permissionsOfRole(memberRole.id())).containsExactlyInAnyOrderElementsOf(grants);
    }

    @Test
    void memberCreatePersistsDraftOwnerIndexesReferencesAndExactFrontAudit() {
        var payload = payload(pet, "Annual check");
        payload.put("ownerPrincipalId", other.id().toString());
        EntryRecord created = me.create(owner, Surface.FRONT, requests.typeKey(), payload).entry();
        EntryRecord persisted = content.findEntry(created.id()).orElseThrow();
        assertThat(persisted.publicationState()).isEqualTo(PublicationState.DRAFT);
        assertThat(persisted.version()).isEqualTo(1);
        assertThat(persisted.slug()).isNull();
        assertThat(persisted.publishedPayload()).isNull();
        assertThat(persisted.payload()).containsEntry("ownerPrincipalId", owner.id().toString()).containsEntry("pet", pet.id().toString());
        assertThat(persisted.createdBy()).isEqualTo(owner.id());
        assertThat(content.indexRowsOf(persisted.id())).anySatisfy(row -> {
            assertThat(row.fieldKey()).isEqualTo("ownerPrincipalId");
            assertThat(row.stringValue()).isEqualTo(owner.id().toString());
        });
        assertThat(content.refsTo(pet.id())).singleElement().satisfies(ref -> {
            assertThat(ref.fromEntryId()).isEqualTo(created.id());
            assertThat(ref.fieldKey()).isEqualTo("pet");
        });
        assertThat(identity.listAudits("entry.create", created.id())).singleElement().satisfies(event -> {
            assertThat(event.actorPrincipalId()).isEqualTo(owner.id());
            assertThat(event.category()).isEqualTo("CONTENT");
            assertThat(event.targetType()).isEqualTo("entry");
            assertThat(event.surface()).isEqualTo("front");
            assertThat(event.outcome()).isEqualTo("ok");
            assertThat(event.detailJson()).isNull();
        });
    }

    @Test
    void ownerFilteringIsAppliedByPostgresAndAnotherMembersGetIsForbidden() {
        EntryRecord mine = me.create(owner, Surface.FRONT, requests.typeKey(), payload(pet, "Mine")).entry();
        EntryRecord theirs = me.create(other, Surface.FRONT, requests.typeKey(), payload(pet(other, "Their pet"), "Theirs")).entry();
        var minePage = me.list(owner, Surface.FRONT, requests.typeKey(), Map.of("state", new String[]{"archived"})).page();
        assertThat(minePage.total()).isEqualTo(1);
        assertThat(minePage.items()).extracting(EntryRecord::id).containsExactly(mine.id());
        var otherPage = me.list(other, Surface.FRONT, requests.typeKey(), Map.of()).page();
        assertThat(otherPage.total()).isEqualTo(1);
        assertThat(otherPage.items()).extracting(EntryRecord::id).containsExactly(theirs.id());
        assertThat(me.get(owner, Surface.FRONT, mine.id()).entry().id()).isEqualTo(mine.id());
        assertThatThrownBy(() -> me.get(other, Surface.FRONT, mine.id())).isInstanceOfSatisfying(IdentityException.class,
                error -> assertThat(error.code()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void foreignOwnedReferenceDenialLeavesAllPersistedStateUnchanged() {
        EntryRecord foreign = pet(other, "Foreign pet");
        var before = counts();
        assertThatThrownBy(() -> me.create(owner, Surface.FRONT, requests.typeKey(), payload(foreign, "Not mine")))
                .isInstanceOfSatisfying(ContentException.class, error -> {
                    assertThat(error.code()).isEqualTo(ErrorCode.REF_TARGET_NOT_FOUND);
                    assertThat(error.fields()).singleElement().satisfies(field -> {
                        assertThat(field.field()).isEqualTo("payload.pet");
                        assertThat(field.message()).isEqualTo("Referenced entry not found");
                    });
                });
        assertThat(counts()).isEqualTo(before);
    }

    @Test
    void auditFailureRollsBackActualMemberEntryIndexesReferencesMediaAndAudit() {
        content.insertField(new FieldRecord(UUID.randomUUID(), requests.id(), "cover", "media-ref", false, false,
                false, "public", 4, null, "restrict", List.of(), true, false));
        Instant now = Instant.now();
        faultMedia = UUID.randomUUID();
        media.insert(new MediaAsset(faultMedia, owner.id(), "cover", "", "cover.png", "image/png", 1, 1, 1, 1,
                "a".repeat(64), "available", null, now, now, List.of()));
        var before = counts();
        var payload = payload(pet, "Rollback");
        payload.put("cover", Map.of("mediaId", faultMedia.toString()));
        failAudit.set(true);
        assertThatThrownBy(() -> me.create(owner, Surface.FRONT, requests.typeKey(), payload))
                .hasMessage("injected audit failure after insert");
        assertThat(attemptedEntry.get()).isNotNull();
        assertThat(content.findEntry(attemptedEntry.get())).isEmpty();
        assertThat(content.indexRowsOf(attemptedEntry.get())).isEmpty();
        assertThat(content.refsTo(pet.id())).isEmpty();
        assertThat(media.attachmentsOfMedia(faultMedia)).isEmpty();
        assertThat(identity.listAudits("entry.create", attemptedEntry.get())).isEmpty();
        assertThat(counts()).isEqualTo(before);
        assertThat(content.findEntry(pet.id()).orElseThrow().payload()).isEqualTo(pet.payload());
    }

    private EntryRecord pet(Principal principal, String name) {
        ContentTypeRecord type = content.findTypeByKey("pet").orElseThrow();
        EntryRecord entry = ContentStoreContract.entry(type, null, PublicationState.DRAFT,
                Map.of("name", name, "ownerPrincipalId", principal.id().toString()), Instant.now());
        content.insertEntry(entry);
        return content.findEntry(entry.id()).orElseThrow();
    }

    private static Map<String, Object> payload(EntryRecord pet, String reason) {
        var payload = new LinkedHashMap<String, Object>();
        payload.put("pet", pet.id().toString());
        payload.put("preferredAt", "2026-10-01T10:00:00Z");
        payload.put("reason", reason);
        return payload;
    }

    private Map<String, Long> counts() {
        var counts = new LinkedHashMap<String, Long>();
        for (String table : List.of("cms_entry", "cms_entry_index", "cms_entry_ref", "cms_media_attachment", "cms_audit_event")) {
            counts.put(table, jdbc.queryForObject("SELECT count(*) FROM " + table, Long.class));
        }
        return counts;
    }
}
