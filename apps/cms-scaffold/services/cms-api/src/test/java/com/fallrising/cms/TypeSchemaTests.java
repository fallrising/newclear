package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class TypeSchemaTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G05_workTypeSchemaHasSettingsAndFieldMetadata() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/album")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.titleField").value("title"))
                .andExpect(jsonPath("$.visibilityField").value("visibility"))
                .andExpect(jsonPath("$.sortField").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.singleton").value(false))
                .andExpect(jsonPath("$.previewable").value(true))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].label").value(hasItem("標題")))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].listable").value(hasItem(true)))
                .andExpect(jsonPath("$.fields[?(@.key=='visibility')].group").value(hasItem("settings")))
                .andExpect(jsonPath("$.fields[?(@.key=='visibility')].filterable").value(hasItem(true)))
                .andExpect(jsonPath("$.fields[?(@.key=='cover')].group").value(hasItem("media")))
                .andExpect(jsonPath("$.fields[?(@.key=='cover')].visibility").value(hasItem("public")));
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo")))
                .andExpect(jsonPath("$.sortField").value("sortOrder"))
                .andExpect(jsonPath("$.fields[?(@.key=='album')].group").value(hasItem("relations")))
                .andExpect(jsonPath("$.fields[?(@.key=='album')].refTarget").value(hasItem("album")));
    }

    @Test
    void G06_enumLabelsAreExposed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-projects", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/issue")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fields[?(@.key=='status')].enumLabels.in_progress").value(hasItem("進行中")))
                .andExpect(jsonPath("$.fields[?(@.key=='status')].enumValues[0]").value(hasItem("backlog")))
                .andExpect(jsonPath("$.fields[?(@.key=='title')].enumLabels").value(hasItem(java.util.Map.of())));
    }

    @Test
    void G05_adminTypeSchemaAddsIndexedAndEnabled() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        mockMvc.perform(admin.apply(get("/api/v1/admin/content-types")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.key=='visit')].ownerField").value(hasItem("ownerPrincipalId")))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].enabled").value(hasItem(true)))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].fields[?(@.key=='scheduledAt')].indexed").value(hasItem(true)))
                .andExpect(jsonPath("$.items[?(@.key=='visit')].fields[?(@.key=='scheduledAt')].label").value(hasItem("預約時間")));
    }

    @Test
    void G11_workTitleUsesTitleField() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/clinic_profile/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].title").value("Cedar Pet Clinic"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/clinic_profile/entries").param("q", "cedar")))
                .andExpect(jsonPath("$.total").value(1));
    }

    @Test
    void G05_unknownTypeIsNotFound() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/no_such_type")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
    }
    @Test
    void G05_backOmitsInternalAndDisabledFieldsWhileAdminKeepsThem() {
        var store = new com.fallrising.cms.content.store.InMemoryContentStore();
        var now = java.time.Instant.parse("2026-01-01T00:00:00Z");
        var type = new com.fallrising.cms.content.domain.ContentTypeRecord(
                java.util.UUID.randomUUID(), "projection_metadata", "Metadata", "Metadata", null, "title",
                "manual", false, true, false, java.util.List.of(), now, now);
        store.insertType(type);
        store.insertField(new com.fallrising.cms.content.domain.FieldRecord(java.util.UUID.randomUUID(), type.id(),
                "title", "string", false, false, true, "public", 0, null, null, java.util.List.of(), true, false));
        store.insertField(new com.fallrising.cms.content.domain.FieldRecord(java.util.UUID.randomUUID(), type.id(),
                "internal_note", "string", false, false, false, "internal", 1, null, null, java.util.List.of(), true, false));
        store.insertField(new com.fallrising.cms.content.domain.FieldRecord(java.util.UUID.randomUUID(), type.id(),
                "disabled_note", "string", false, false, false, "back", 2, null, null, java.util.List.of(), false, false));
        var identity = new com.fallrising.cms.identity.web.IdentityRequest();
        identity.setSurface(com.fallrising.cms.identity.domain.Surface.BACK);
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.setAttribute(com.fallrising.cms.identity.web.IdentityErrorWriter.ATTR, identity);
        var back = new com.fallrising.cms.content.web.EntryController(null, store);
        var backJson = back.type(type.typeKey(), request);
        org.assertj.core.api.Assertions.assertThat(backJson).doesNotContainKey("enabled");
        @SuppressWarnings("unchecked")
        var backFields = (java.util.List<java.util.Map<String, Object>>) backJson.get("fields");
        org.assertj.core.api.Assertions.assertThat(backFields).extracting(f -> f.get("key")).containsExactly("title");
        org.assertj.core.api.Assertions.assertThat(backFields.getFirst()).containsKeys("label", "group", "listable",
                "filterable", "enumLabels", "placeholder", "helpText", "visibility", "order")
                .doesNotContainKeys("indexed", "enabled");
        identity.setSurface(com.fallrising.cms.identity.domain.Surface.ADMIN);
        var authorization = org.mockito.Mockito.mock(com.fallrising.cms.identity.service.AuthorizationService.class);
        var admin = new com.fallrising.cms.content.web.AdminContentController(store, null, null, null, authorization);
        @SuppressWarnings("unchecked")
        var adminTypes = (java.util.List<java.util.Map<String, Object>>) admin.listTypes(request).get("items");
        org.assertj.core.api.Assertions.assertThat(adminTypes.getFirst()).containsEntry("enabled", true);
        @SuppressWarnings("unchecked")
        var adminFields = (java.util.List<java.util.Map<String, Object>>) adminTypes.getFirst().get("fields");
        org.assertj.core.api.Assertions.assertThat(adminFields).extracting(f -> f.get("key"))
                .containsExactly("title", "internal_note", "disabled_note");
        org.assertj.core.api.Assertions.assertThat(adminFields.getFirst()).containsEntry("indexed", true).containsEntry("enabled", true);
        org.assertj.core.api.Assertions.assertThat(adminFields.getLast()).containsEntry("enabled", false);
    }

    @Test
    void G01_directoryReturnsOnlyEnabledTypesInAscendingKeyOrder() {
        var store = new com.fallrising.cms.content.store.InMemoryContentStore();
        var now = java.time.Instant.parse("2026-01-01T00:00:00Z");
        for (String key : java.util.List.of("zebra", "disabled", "album")) {
            store.insertType(new com.fallrising.cms.content.domain.ContentTypeRecord(
                    java.util.UUID.randomUUID(), key, key, key, null, null, "manual", false,
                    !key.equals("disabled"), false, java.util.List.of(), now, now));
        }
        org.assertj.core.api.Assertions.assertThat(new com.fallrising.cms.content.web.StoreContentTypeDirectory(store).enabledTypeKeys())
                .containsExactly("album", "zebra");
    }

    @Test
    void G11_missingTypeRowReturnsNullWorkTitle() {
        var store = new com.fallrising.cms.content.store.InMemoryContentStore();
        var now = java.time.Instant.parse("2026-01-01T00:00:00Z");
        var entry = new com.fallrising.cms.content.domain.EntryRecord(java.util.UUID.randomUUID(),
                java.util.UUID.randomUUID(), "missing_type", "entry", com.fallrising.cms.content.domain.PublicationState.DRAFT,
                1, java.util.Map.of("title", "Old conventional title"), null, null, null, null, null, null, now, now);
        var entries = org.mockito.Mockito.mock(com.fallrising.cms.content.service.EntryService.class);
        org.mockito.Mockito.when(entries.getWork(null, com.fallrising.cms.identity.domain.Surface.BACK, entry.id())).thenReturn(entry);
        var identity = new com.fallrising.cms.identity.web.IdentityRequest();
        identity.setSurface(com.fallrising.cms.identity.domain.Surface.BACK);
        var request = new org.springframework.mock.web.MockHttpServletRequest();
        request.setAttribute(com.fallrising.cms.identity.web.IdentityErrorWriter.ATTR, identity);
        var json = new com.fallrising.cms.content.web.EntryController(entries, store).get(entry.id(), request);
        org.assertj.core.api.Assertions.assertThat(json).containsEntry("title", null)
                .containsEntry("payload", entry.payload()).containsEntry("version", 1);
    }

}
