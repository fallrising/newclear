package com.fallrising.cms;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.EntryRefRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class EntryPurgeConfirmationApiTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired IdentityStore identities;
    @MockitoSpyBean ContentStore content;
    ApiFixture api;
    TestSession admin;
    UUID id;
    EntryRecord before;

    @BeforeEach void freshEntry() throws Exception {
        api = new ApiFixture(mvc, mapper);
        admin = TestSession.login(mvc, "seed-admin", IdentityAuthTests.PASSWORD, TestSession.ADMIN);
        id = UUID.fromString(api.create(admin, "page", Map.of("title", "Purge fixture", "body", "fixture")).get("id").asText());
        before = content.findEntry(id).orElseThrow();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "{}", "{\"confirmPhrase\":\"DELETE\"}", "{\"confirmId\":\"$id\"}",
            "{\"confirmPhrase\":\"delete\",\"confirmId\":\"$id\"}", "{\"confirmPhrase\":\"DELETE \",\"confirmId\":\"$id\"}",
            "{\"confirmPhrase\":\"DELETE\",\"confirmId\":\" $id\"}", "{\"confirmPhrase\":\"DELETE\",\"confirmId\":\"wrong\"}"})
    void PP1FM06_purgeRequiresRawWordAndTarget(String body) throws Exception {
        purge(admin, id.toString(), body.replace("$id", id.toString()))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("CONFIRMATION_REQUIRED"));
        assertThat(content.findEntry(id).orElseThrow()).isEqualTo(before);
        denial(id, "CONFIRMATION_REQUIRED");
    }

    @Test void nonCanonicalUuidAndHeadersDoNotConfirm() throws Exception {
        purge(admin, id.toString(), body(id.toString().toUpperCase(java.util.Locale.ROOT)))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("CONFIRMATION_REQUIRED"));
        mvc.perform(admin.apply(post(path(id.toString()))).header("confirmPhrase", "DELETE").header("confirmId", id))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("CONFIRMATION_REQUIRED"));
        assertThat(content.findEntry(id).orElseThrow()).isEqualTo(before);
        assertThat(identities.listAudits("entry.purge", id)).hasSize(2);
    }

    @ParameterizedTest @ValueSource(strings = {"id", "slug"})
    void exactConfirmationAndIgnoredUnknownKeySucceed(String target) throws Exception {
        String confirmation = target.equals("id") ? id.toString() : before.slug();
        purge(admin, id.toString(), mapper.writeValueAsString(Map.of("confirmPhrase", "DELETE", "confirmId", confirmation, "ignored", "not-confirmation")))
                .andExpect(status().isNoContent()).andExpect(content().string(""));
        assertThat(content.findEntry(id)).isEmpty();
        assertThat(identities.listAudits("entry.purge", id)).hasSize(1).allMatch(a -> a.outcome().equals("ok"));
        mvc.perform(get("/api/v1/public/content-types/page/entries/{id}", id)).andExpect(status().isNotFound());
    }

    @Test void emptyAndNullSlugsNeverAcceptEmptyConfirmation() throws Exception {
        for (String slug : new String[]{"", null}) {
            var now = Instant.now();
            var empty = new EntryRecord(UUID.randomUUID(), before.contentTypeId(), "page", slug, PublicationState.DRAFT,
                    1, Map.of("title", "Legacy slug"), null, null, null, null, before.createdBy(), before.updatedBy(), now, now);
            content.insertEntry(empty);
            purge(admin, empty.id().toString(), body("")).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("CONFIRMATION_REQUIRED"));
            assertThat(content.findEntry(empty.id())).contains(empty);
            denial(empty.id(), "CONFIRMATION_REQUIRED");
            purge(admin, empty.id().toString(), body(empty.id().toString())).andExpect(status().isNoContent());
        }
    }

    @Test void PP1FM06_purgeGateOrderIsStable() throws Exception {
        mvc.perform(post(path(id.toString()))).andExpect(status().isUnauthorized());
        var back = new TestSession(TestSession.BACK, admin.token(), admin.csrf());
        purge(back, id.toString(), "{}").andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        denial(id, "SURFACE_FORBIDDEN");
        var member = api.principalWithRole(admin, "member", List.of(), TestSession.ADMIN);
        UUID absent = UUID.randomUUID();
        purge(member, absent.toString(), "{}").andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        denial(absent, "FORBIDDEN");
        UUID missing = UUID.randomUUID();
        purge(admin, missing.toString(), "{}").andExpect(status().isNotFound()).andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
        assertThat(identities.listAudits("entry.purge", missing)).isEmpty();
        assertThat(content.findEntry(id)).contains(before);
    }

    @Test void malformedAndTransportFailuresHaveNoBusinessAudit() throws Exception {
        purge(admin, id.toString(), "{").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        purge(admin, "not-uuid", "{}").andExpect(status().isBadRequest());
        mvc.perform(admin.apply(post(path(id.toString()))).contentType(MediaType.TEXT_PLAIN).content("DELETE"))
                .andExpect(status().isUnsupportedMediaType()).andExpect(jsonPath("$.error.code").value("MEDIA_TYPE_NOT_SUPPORTED"));
        mvc.perform(new TestSession("https://wrong.example", admin.token(), admin.csrf()).apply(post(path(id.toString()))))
                .andExpect(status().isForbidden());
        mvc.perform(post(path(id.toString())).header("Origin", TestSession.ADMIN)
                .cookie(new org.springframework.mock.web.MockCookie("cms_session", admin.token())))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("CSRF_FAILED"));
        assertThat(identities.listAudits("entry.purge", id)).isEmpty();
        assertThat(content.findEntry(id)).contains(before);
    }

    @Test void confirmationPrecedesReferencesAndCasStillRejects() throws Exception {
        UUID source = UUID.fromString(api.create(admin, "page", Map.of("title", "Reference fixture")).get("id").asText());
        var ref = new EntryRefRecord(source, "test", id, "entry", 0);
        content.replaceRefs(source, List.of(ref));
        purge(admin, id.toString(), "{}").andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("CONFIRMATION_REQUIRED"));
        purge(admin, id.toString(), body(id.toString())).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("REF_CONSTRAINT"));
        assertThat(content.refsTo(id)).containsExactly(ref);
        assertThat(content.findEntry(id)).contains(before);
        UUID casId = UUID.fromString(api.create(admin, "page", Map.of("title", "CAS fixture")).get("id").asText());
        var casBefore = content.findEntry(casId);
        doThrow(ContentException.versionConflict()).when(content).hardDeleteEntry(casId, 1);
        purge(admin, casId.toString(), body(casId.toString())).andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"));
        assertThat(content.findEntry(casId)).isEqualTo(casBefore);
        denial(casId, "VERSION_CONFLICT");
    }

    private ResultActions purge(TestSession actor, String target, String body) throws Exception {
        var request = actor.apply(post(path(target))).contentType(MediaType.APPLICATION_JSON);
        if (!body.isEmpty()) request.content(body);
        return mvc.perform(request);
    }
    private String body(String target) throws Exception { return mapper.writeValueAsString(Map.of("confirmPhrase", "DELETE", "confirmId", target)); }
    private static String path(String target) { return "/api/v1/admin/entries/" + target + "/purge"; }
    private void denial(UUID target, String reason) throws Exception {
        var audits = identities.listAudits("entry.purge", target);
        assertThat(audits).hasSize(1);
        assertThat(audits.getFirst().category()).isEqualTo("CONTENT");
        assertThat(audits.getFirst().outcome()).isEqualTo("denied");
        assertThat(mapper.readTree(audits.getFirst().detailJson())).isEqualTo(mapper.valueToTree(Map.of("reason", reason)));
    }
}
