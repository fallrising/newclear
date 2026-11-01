package com.fallrising.cms;

import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-08: /me endpoints; surface-front AC-10 (sign-in wall), AC-11 (someone else's request), AC-12 (Front command). */
@SpringBootTest
@AutoConfigureMockMvc
class MemberApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Autowired
    ContentStore content;

    @Autowired
    IdentityStore identity;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void AC10_membersAreSignedInAndSeeOnlyTheirOwnEntries() throws Exception {
        mockMvc.perform(get("/api/v1/me/content-types/pet/entries").header("Origin", TestSession.FRONT))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))))
                .andExpect(jsonPath("$.items[0].payload.name").value("Leo"))
                .andExpect(jsonPath("$.items[0].publicationState").value("published"));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/album/entries")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
    }

    @Test
    void BW3_meIsFrontOnly() throws Exception {
        TestSession back = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/me/content-types/pet/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
    }

    @Test
    void AC12_memberCreatesADraftRequestOwnedByThemselves() throws Exception {
        TestSession member = freshMember();
        String leo = ownPet(member);
        String memberId = api.json(mockMvc.perform(member.apply(get("/api/v1/auth/me")))).get("principal").get("id").asText();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("pet", leo);
        payload.put("preferredAt", "2026-10-01T10:00:00+08:00");
        payload.put("reason", "Annual check " + ApiFixture.token("x"));
        payload.put("ownerPrincipalId", UUID.randomUUID().toString());
        JsonNode created = api.json(createRequest(member, Map.of("payload", payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.publicationState").value("draft"))
                .andExpect(jsonPath("$.payload.ownerPrincipalId").value(memberId)));
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", created.get("id").asText())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value(payload.get("reason")));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/appointment_request/entries").param("q", (String) payload.get("reason"))))
                .andExpect(jsonPath("$.total").value(1));

        createRequest(member, Map.of("payload", payload, "publicationState", "published"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void BW3_requiredFieldsForeignRefsAndTypesWithoutCreateAreRejected() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        JsonNode pets = api.json(mockMvc.perform(op.apply(get("/api/v1/content-types/pet/entries").param("q", "Basil"))));
        String basil = pets.get("items").get(0).get("id").asText();
        TestSession member = freshMember();
        createRequest(member, Map.of("payload", Map.of("pet", basil, "preferredAt", "2026-10-01T10:00:00Z", "reason", "Not mine")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("REF_TARGET_NOT_FOUND"))
                .andExpect(jsonPath("$.error.fields[0].field").value("payload.pet"));
        createRequest(member, Map.of("payload", Map.of("preferredAt", "2026-10-01T10:00:00Z")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[*].field").value(equalTo(List.of("payload.pet", "payload.reason"))))
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        mockMvc.perform(member.apply(post("/api/v1/me/content-types/pet/entries")).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("payload", Map.of("title", "New pet")))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void AC11_anotherMembersRequestIsForbiddenAndCreatesAreRateLimited() throws Exception {
        TestSession owner = freshMember();
        String leo = ownPet(owner);
        String requestId = api.json(createRequest(owner, Map.of("payload",
                        Map.of("pet", leo, "preferredAt", "2026-11-01T10:00:00Z", "reason", "Owner only")))
                .andExpect(status().isCreated())).get("id").asText();

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        TestSession other = api.principalWithRole(admin, "member", List.of(), TestSession.FRONT);
        mockMvc.perform(other.apply(get("/api/v1/me/entries/{id}", requestId)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mockMvc.perform(other.apply(get("/api/v1/me/content-types/appointment_request/entries")))
                .andExpect(jsonPath("$.total").value(0));

        Map<String, Object> invalid = Map.of("payload", Map.of("preferredAt", "tomorrow", "reason", "x"));
        for (int i = 0; i < 5; i++) {
            createRequest(other, invalid).andExpect(status().isUnprocessableEntity());
        }
        createRequest(other, invalid)
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error.code").value("RATE_LIMITED"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"<absent>", "{}", "{\"payload\":null}", "{\"payload\":\"text\"}", "{\"payload\":7}", "{\"payload\":[]}"})
    void malformedCreateBodyIsRejectedBeforeQuota(String body) throws Exception {
        TestSession member = freshMember();
        for (int i = 0; i < 6; i++) {
            var request = member.apply(post("/api/v1/me/content-types/appointment_request/entries"))
                    .contentType(MediaType.APPLICATION_JSON);
            if (!"<absent>".equals(body)) request.content(body);
            mockMvc.perform(request).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        for (int i = 0; i < 5; i++) {
            createRequest(member, Map.of("payload", Map.of())).andExpect(status().isUnprocessableEntity());
        }
        createRequest(member, Map.of("payload", Map.of())).andExpect(status().isTooManyRequests());
    }

    @Test
    void statePresenceIncludingNullIsRejectedAfterAccessChecksAndBeforeQuota() throws Exception {
        TestSession member = freshMember();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("publicationState", null);
        body.put("payload", Map.of());
        for (int i = 0; i < 6; i++) {
            createRequest(member, body).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(post("/api/v1/me/content-types/appointment_request/entries")
                        .header("Origin", TestSession.FRONT).contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andExpect(status().isUnauthorized());
        TestSession back = new TestSession(TestSession.BACK, member.token(), member.csrf());
        createRequest(back, body).andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        mockMvc.perform(member.apply(post("/api/v1/me/content-types/pet/entries"))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        for (int i = 0; i < 5; i++) {
            createRequest(member, Map.of("payload", Map.of())).andExpect(status().isUnprocessableEntity());
        }
        createRequest(member, Map.of("payload", Map.of())).andExpect(status().isTooManyRequests());
    }

    @Test
    void listValidatesGrammarAndUsesFixedStatesAndLongOffsets() throws Exception {
        TestSession member = freshMember();
        String draft = ownPet(member);
        String published = ownPet(member);
        String archived = ownPet(member);
        String deleted = ownPet(member);
        rewritePet(published, PublicationState.PUBLISHED, false, null, null);
        rewritePet(archived, PublicationState.ARCHIVED, false, null, null);
        rewritePet(deleted, PublicationState.DRAFT, true, null, null);
        JsonNode result = api.json(mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries"))
                        .param("state", "archived").param("publishRequested", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(2)));
        assertThat(result.get("items").findValuesAsText("id")).containsExactlyInAnyOrder(draft, published);
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", archived)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.publicationState").value("archived"));
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", deleted)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries"))
                        .param("page", "2147483647").param("size", "100"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.offset").value(214748364600L))
                .andExpect(jsonPath("$.items").isEmpty());
        for (Map.Entry<String, String> invalid : Map.of("page", "0", "state", "deleted", "publishRequested", "yes",
                "ref.ownerPrincipalId", "not-a-uuid", "filter.noSuchField", "x", "sort", "noSuchField").entrySet()) {
            mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries"))
                            .param(invalid.getKey(), invalid.getValue()))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/pet/entries")).param("page", "1", "2"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void ownershipAndTitleComeFromWorkingPayloadNotPublishedSnapshot() throws Exception {
        TestSession former = freshMember();
        TestSession current = freshMember();
        String id = ownPet(former);
        EntryRecord before = content.findEntry(UUID.fromString(id)).orElseThrow();
        Map<String, Object> working = new LinkedHashMap<>(before.payload());
        working.put("ownerPrincipalId", principalId(current));
        working.put("title", "Current working title");
        rewritePet(id, PublicationState.PUBLISHED, false, working, before.payload());
        mockMvc.perform(former.apply(get("/api/v1/me/entries/{id}", id)))
                .andExpect(status().isForbidden());
        mockMvc.perform(former.apply(get("/api/v1/me/content-types/pet/entries")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(0));
        mockMvc.perform(current.apply(get("/api/v1/me/entries/{id}", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.title").value("Current working title"))
                .andExpect(jsonPath("$.version").doesNotExist()).andExpect(jsonPath("$.publishedPayload").doesNotExist());
        mockMvc.perform(current.apply(get("/api/v1/me/content-types/pet/entries"))
                        .param("q", "Current working").param("ref.ownerPrincipalId", principalId(current)).param("sort", "-title"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(id));
    }

    @Test
    void disabledRequiredAndForeignFieldsDoNotBlockCreateAndDisabledTypesAreHidden() throws Exception {
        TestSession member = freshMember();
        String otherPet = ownPet(freshMember());
        String key = ApiFixture.token("member_type_");
        Instant now = Instant.now();
        ContentTypeRecord type = new ContentTypeRecord(UUID.randomUUID(), key, key, key, null, "title", "none",
                false, true, false, List.of(), now, now, null, null, "ownerPrincipalId");
        content.insertType(type);
        content.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "title", "string", true, false, true,
                "back", 0, null, "restrict", List.of(), true, false));
        content.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "ownerPrincipalId", "principal-ref", true, false, true,
                "public", 1, null, "restrict", List.of(), true, false));
        content.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "disabledRequired", "string", true, false, false,
                "public", 2, null, "restrict", List.of(), false, false));
        content.insertField(new FieldRecord(UUID.randomUUID(), type.id(), "disabledForeign", "ref", true, false, false,
                "public", 3, "pet", "restrict", List.of(), false, false));
        identity.insertPermission(new Permission(UUID.randomUUID(), identity.findRoleByCode("member").orElseThrow().id(),
                "create", key, null, List.of("front"), now));
        JsonNode created = api.json(mockMvc.perform(member.apply(post("/api/v1/me/content-types/{type}/entries", key))
                        .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("payload",
                                Map.of("title", "Private title", "disabledForeign", otherPet)))))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.title").isEmpty())
                .andExpect(jsonPath("$.payload.title").doesNotExist())
                .andExpect(jsonPath("$.payload.disabledForeign").doesNotExist()));
        content.updateType(type.withEnabled(false, now));
        mockMvc.perform(member.apply(get("/api/v1/me/entries/{id}", created.get("id").asText())))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        mockMvc.perform(member.apply(get("/api/v1/me/content-types/{type}/entries", key)))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
        mockMvc.perform(member.apply(post("/api/v1/me/content-types/{type}/entries", key))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"payload\":{}}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
    }

    @Test
    void memberCreateRetainsPayloadTypeRefAndReservedKeyValidation() throws Exception {
        TestSession member = freshMember();
        String pet = ownPet(member);
        for (Map.Entry<String, Object> invalid : Map.<String, Object>of("preferredAt", "tomorrow", "pet", "invalid-id",
                "version", 1).entrySet()) {
            Map<String, Object> payload = new LinkedHashMap<>(Map.of("pet", pet, "preferredAt", "2026-10-01T10:00:00Z", "reason", "Check"));
            payload.put(invalid.getKey(), invalid.getValue());
            createRequest(member, Map.of("payload", payload)).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.fields[0].field").value("payload." + invalid.getKey()));
        }
        Map<String, Object> missingRef = Map.of("pet", UUID.randomUUID().toString(), "preferredAt", "2026-10-01T10:00:00Z", "reason", "Check");
        createRequest(member, Map.of("payload", missingRef)).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("REF_TARGET_NOT_FOUND"));
    }

    private void rewritePet(String id, PublicationState state, boolean deleted, Map<String, Object> working, Map<String, Object> published) {
        EntryRecord before = content.findEntry(UUID.fromString(id)).orElseThrow();
        Instant now = Instant.now();
        content.updateEntry(new EntryRecord(before.id(), before.contentTypeId(), before.contentTypeKey(), before.slug(), state,
                before.version() + 1, working == null ? before.payload() : working,
                published == null ? before.payload() : published, state == PublicationState.PUBLISHED ? now : null,
                state == PublicationState.ARCHIVED ? now : null, deleted ? now : null,
                before.createdBy(), before.updatedBy(), before.createdAt(), now));
        Map<String, Object> nextPayload = working == null ? before.payload() : working;
        content.replaceRefs(before.id(), List.of(new EntryRefRecord(before.id(), "ownerPrincipalId",
                UUID.fromString((String) nextPayload.get("ownerPrincipalId")), "principal", 0)));
    }

    private TestSession freshMember() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        return api.principalWithRole(admin, "member", List.of(), TestSession.FRONT);
    }

    private String principalId(TestSession member) throws Exception {
        return api.json(mockMvc.perform(member.apply(get("/api/v1/auth/me")))).get("principal").get("id").asText();
    }

    private String ownPet(TestSession member) throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        return api.create(op, "pet", Map.of("title", ApiFixture.token("MyPet"), "ownerPrincipalId", principalId(member))).get("id").asText();
    }

    private ResultActions createRequest(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/me/content-types/appointment_request/entries"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

}
