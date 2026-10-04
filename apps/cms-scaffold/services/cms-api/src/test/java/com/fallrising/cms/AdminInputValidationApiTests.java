package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.UUID;
import java.time.Instant;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.crypto.SessionTokens;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 02 BQ-08: admin inputs that the database would reject (column length, CHECK, UNIQUE) are rejected before any write:
 * content types with 422 FIELD_VALIDATION and error.fields, principals and role permissions with 400 VALIDATION_FAILED.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminInputValidationApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    ContentStore content;

    @Autowired
    IdentityStore identity;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ08_contentTypeCreateReportsEveryInvalidInput() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String key = "bq08_" + ApiFixture.token("t").toLowerCase().replaceAll("[^a-z0-9]", "");
        Map<String, Object> body = Map.of(
                "key", key,
                "displayName", "x".repeat(81),
                "titleField", "t".repeat(64),
                "slugPolicy", "sometimes",
                "fields", List.of(
                        Map.of("type", "string"),
                        Map.of("key", "k".repeat(64), "type", "string"),
                        Map.of("key", "dup", "type", "string"),
                        Map.of("key", "dup", "type", "string"),
                        Map.of("key", "shape", "type", "photo"),
                        Map.of("key", "owner", "type", "ref", "refTarget", "r".repeat(64))));
        JsonNode error = mapper.readTree(createType(admin, body)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))
                .andReturn().getResponse().getContentAsString()).get("error");
        List<String> fields = new ArrayList<>();
        error.get("fields").forEach(f -> fields.add(f.get("field").asText() + " " + f.get("code").asText()));
        assertThat(fields).containsExactly(
                "displayName TOO_LONG",
                "titleField TOO_LONG",
                "slugPolicy NOT_IN_ENUM",
                "fields[0].key REQUIRED",
                "fields[1].key TOO_LONG",
                "fields[3].key DUPLICATE",
                "fields[4].type NOT_IN_ENUM",
                "fields[5].refTarget TOO_LONG");
        assertThat(mockMvc.perform(admin.apply(get("/api/v1/admin/content-types"))).andReturn().getResponse()
                .getContentAsString()).doesNotContain(key);

        createType(admin, Map.of("key", "Not-A-Key"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].field").value("key"))
                .andExpect(jsonPath("$.error.fields[0].code").value("INVALID_FORMAT"));
        createType(admin, Map.of("key", "album"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].field").value("key"))
                .andExpect(jsonPath("$.error.fields[0].code").value("DUPLICATE"));
    }

    @Test
    void BQ08_principalAndPermissionInputsThatTheDatabaseRejectsAre400() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String name = ApiFixture.token("p").toLowerCase().replaceAll("[^a-z0-9]", "");
        String email = name + "@Example.test";

        createPrincipal(admin, Map.of("username", name + "a", "displayName", "d".repeat(81)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.message", containsString("displayName")));
        createPrincipal(admin, Map.of("username", name + "b", "email", "e".repeat(243) + "@example.test"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email")));
        String first = mapper.readTree(createPrincipal(admin, Map.of("username", name + "c", "email", email))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
        createPrincipal(admin, Map.of("username", name + "d", "email", email.toUpperCase()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email is taken")));
        String second = mapper.readTree(createPrincipal(admin, Map.of("username", name + "e"))
                .andExpect(status().isCreated()).andReturn().getResponse().getContentAsString()).get("id").asText();
        patchPrincipal(admin, second, Map.of("email", email))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("email is taken")));
        patchPrincipal(admin, second, Map.of("displayName", "d".repeat(81)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("displayName")));
        patchPrincipal(admin, first, Map.of("email", email.toLowerCase(), "displayName", "Same address"))
                .andExpect(status().isOk());

        var oldPermissions = identity.permissionsOfRole(identity.findRoleByCode("editor").orElseThrow().id());
        var oldEvents = identity.listAudits("role.permissions_update", null);
        mockMvc.perform(admin.apply(put("/api/v1/roles/{code}/permissions", "editor")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(List.of(Map.of("action", "read_draft",
                                "contentTypeCode", "c".repeat(65), "allowedSurfaces", List.of("back")))))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.message", containsString("contentTypeCode")));
        assertThat(identity.permissionsOfRole(identity.findRoleByCode("editor").orElseThrow().id())).isEqualTo(oldPermissions);
        assertThat(identity.listAudits("role.permissions_update", null)).isEqualTo(oldEvents);
    }

    @Test
    void BQ08_allTypeProblemsAreOrderedAndNoTypeFieldOrAuditIsWritten() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        var types = content.listTypes();
        var fields = content.fieldsOf(content.findTypeByKey("album").orElseThrow().id());
        var events = identity.listAudits("type.create", null);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("key", "album");
        body.put("displayName", "😀".repeat(81));
        body.put("pluralDisplayName", "😀".repeat(81));
        body.put("titleField", "😀".repeat(64));
        body.put("slugPolicy", "unknown");
        body.put("fields", Arrays.asList(null, Map.of("key", " "),
                Map.of("key", "😀".repeat(64)), Map.of("key", "dup"),
                Map.of("key", "dup", "type", "unknown", "refTarget", "😀".repeat(64))));
        JsonNode error = json(createType(admin, body).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FIELD_VALIDATION"))).get("error");
        List<String> paths = new ArrayList<>();
        error.get("fields").forEach(field -> paths.add(field.get("field").asText() + " " + field.get("code").asText()));
        assertThat(paths).containsExactly("key DUPLICATE", "displayName TOO_LONG", "pluralDisplayName TOO_LONG",
                "titleField TOO_LONG", "slugPolicy NOT_IN_ENUM", "fields[0] REQUIRED", "fields[1].key REQUIRED",
                "fields[2].key TOO_LONG", "fields[4].key DUPLICATE", "fields[4].type NOT_IN_ENUM", "fields[4].refTarget TOO_LONG");
        for (String key : List.of("", " ")) {
            createType(admin, Map.of("key", key)).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        }
        Map<String, Object> nullKey = new LinkedHashMap<>();
        nullKey.put("key", null);
        createType(admin, nullKey).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        createType(admin, Map.of()).andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.fields[0].code").value("REQUIRED"));
        for (String key : List.of("a", "a".repeat(64), "Uppercase", "a-b")) {
            createType(admin, Map.of("key", key)).andExpect(status().isUnprocessableEntity())
                    .andExpect(jsonPath("$.error.fields[0].code").value("INVALID_FORMAT"));
        }
        assertThat(content.listTypes()).isEqualTo(types);
        assertThat(content.fieldsOf(content.findTypeByKey("album").orElseThrow().id())).isEqualTo(fields);
        assertThat(identity.listAudits("type.create", null)).isEqualTo(events);
    }

    @Test
    void BQ08_typeBoundariesUnicodeAndEverySupportedFieldTypeAreAccepted() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        List<String> fieldTypes = List.of("string", "markdown", "int", "boolean", "datetime", "enum", "ref", "principal-ref", "media-ref");
        List<Map<String, Object>> fields = new ArrayList<>();
        for (int i = 0; i < fieldTypes.size(); i++) {
            fields.add(Map.of("key", i == 0 ? "😀".repeat(63) : "f" + i,
                    "type", fieldTypes.get(i), "refTarget", "😀".repeat(63)));
        }
        fields.add(Map.of("key", "default_type"));
        for (String policy : List.of("required", "optional", "none")) {
            String key = ApiFixture.token("boundary") + "k".repeat(47);
            JsonNode created = json(createType(admin, Map.of("key", key, "displayName", "😀".repeat(80),
                    "pluralDisplayName", "😀".repeat(80), "titleField", "😀".repeat(63),
                    "slugPolicy", policy, "fields", fields)).andExpect(status().isCreated()));
            assertThat(created.get("key").asText()).isEqualTo(key);
            assertThat(created.get("displayName").asText()).isEqualTo("😀".repeat(80));
            var persisted = content.fieldsOf(content.findTypeByKey(key).orElseThrow().id());
            assertThat(persisted).hasSize(10);
            assertThat(persisted).extracting(field -> field.fieldType())
                    .containsExactly("string", "markdown", "int", "boolean", "datetime", "enum", "ref", "principal-ref", "media-ref", "string");
        }
        String shortKey = List.of("zz", "zy", "zx").stream().filter(key -> content.findTypeByKey(key).isEmpty()).findFirst().orElseThrow();
        createType(admin, Map.of("key", shortKey)).andExpect(status().isCreated());
        JsonNode defaults = json(createType(admin, Map.of("key", ApiFixture.token("defaults"))).andExpect(status().isCreated()));
        assertThat(defaults.get("slugPolicy").asText()).isEqualTo("optional");
        assertThat(defaults.get("titleField").asText()).isEqualTo("title");
    }

    @Test
    void BQ08_profileBoundariesAndRejectedChangesLeavePrincipalCredentialRolesAndAuditIntact() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String name = ApiFixture.token("profile");
        String email = name + "e".repeat(254 - name.length());
        String temporary = "Pw-" + UUID.randomUUID() + "-Aa1";
        String id = json(createPrincipal(admin, Map.of("username", name, "displayName", "😀".repeat(80), "email", email,
                "temporaryPassword", temporary)).andExpect(status().isCreated())).get("id").asText();
        TestSession owner = TestSession.login(mockMvc, name, temporary, TestSession.FRONT);
        var session = identity.findSessionByTokenHash(SessionTokens.sha256(owner.token())).orElseThrow();
        UUID uuid = UUID.fromString(id);
        var original = identity.findPrincipalById(uuid).orElseThrow();
        var credential = identity.findPasswordCredential(uuid);
        var roles = identity.rolesOf(uuid);
        var events = identity.listAudits(null, null);
        for (Map<String, Object> body : List.<Map<String, Object>>of(Map.of("displayName", "😀".repeat(81), "status", "disabled"),
                Map.of("email", email + "e", "status", "disabled"))) {
            patchPrincipal(admin, id, body).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
            assertThat(identity.findPrincipalById(uuid)).contains(original);
            assertThat(identity.findPasswordCredential(uuid)).isEqualTo(credential);
            assertThat(identity.rolesOf(uuid)).isEqualTo(roles);
            assertThat(identity.findSessionByTokenHash(SessionTokens.sha256(owner.token()))).contains(session);
            assertThat(identity.listAudits(null, null)).isEqualTo(events);
        }
        for (Map<String, Object> body : List.<Map<String, Object>>of(Map.of("displayName", "😀".repeat(81)), Map.of("email", "😀".repeat(255)))) {
            String rejected = ApiFixture.token("reject");
            Map<String, Object> create = new LinkedHashMap<>(body);
            create.put("username", rejected);
            createPrincipal(admin, create).andExpect(status().isBadRequest());
            assertThat(identity.findPrincipalByUsername(rejected)).isEmpty();
            assertThat(identity.listAudits(null, null)).isEqualTo(events);
        }
        mockMvc.perform(owner.apply(get("/api/v1/auth/me"))).andExpect(status().isOk());
        patchPrincipal(admin, id, Map.of("email", email.toUpperCase(java.util.Locale.ROOT), "displayName", "😀".repeat(80)))
                .andExpect(status().isOk());
        String unicodeEmail = "😀".repeat(254);
        createPrincipal(admin, Map.of("username", ApiFixture.token("unicode"), "email", unicodeEmail))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.email").value(unicodeEmail));
    }

    @Test
    void BQ08_permissionValidationIsCompleteBeforeReplacingAnyGrant() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        Role role = identity.findRoleByCode("editor").orElseThrow();
        var permissions = identity.permissionsOfRole(role.id());
        var events = identity.listAudits("role.permissions_update", null);
        replacePermissions(admin, role.code(), List.of(Map.of("action", "read_draft", "contentTypeCode", "album"),
                Map.of("action", "create", "contentTypeCode", "😀".repeat(65))))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.message", containsString("contentTypeCode")));
        assertThat(identity.permissionsOfRole(role.id())).isEqualTo(permissions);
        assertThat(identity.listAudits("role.permissions_update", null)).isEqualTo(events);
        Role custom = new Role(UUID.randomUUID(), ApiFixture.token("role"), "Boundary role", false, Instant.now());
        identity.insertRole(custom);
        replacePermissions(admin, custom.code(), List.of(Map.of("action", "read_draft", "contentTypeCode", "😀".repeat(64))))
                .andExpect(status().isNoContent());
        assertThat(identity.permissionsOfRole(custom.id())).hasSize(1);
        assertThat(identity.permissionsOfRole(custom.id()).getFirst().contentTypeCode()).isEqualTo("😀".repeat(64));
    }

    @Test
    void BQ08_authorizationPrecedesTypeProfileAndPermissionValidation() throws Exception {
        for (String[] row : List.of(new String[]{"seed-admin", TestSession.FRONT, "SURFACE_FORBIDDEN"},
                new String[]{"seed-admin", TestSession.BACK, "SURFACE_FORBIDDEN"},
                new String[]{"seed-editor-clinic", TestSession.ADMIN, "FORBIDDEN"})) {
            TestSession session = TestSession.login(mockMvc, row[0], password, row[1]);
            createType(session, Map.of("key", "Invalid-key", "fields", Arrays.asList((Object) null)))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(row[2]));
            createPrincipal(session, Map.of("username", ApiFixture.token("denied"), "displayName", "d".repeat(81)))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(row[2]));
            patchPrincipal(session, UUID.randomUUID().toString(), Map.of("displayName", "d".repeat(81)))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(row[2]));
            replacePermissions(session, "editor", List.of(Map.of("action", "create", "contentTypeCode", "c".repeat(65))))
                    .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(row[2]));
        }
    }

    private ResultActions replacePermissions(TestSession session, String role, List<Map<String, Object>> body) throws Exception {
        return mockMvc.perform(session.apply(put("/api/v1/roles/{code}/permissions", role)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }

    private JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private ResultActions createType(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/admin/content-types")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }

    private ResultActions createPrincipal(TestSession session, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/principals")
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }

    private ResultActions patchPrincipal(TestSession session, String id, Map<String, Object> body) throws Exception {
        return mockMvc.perform(session.apply(patch("/api/v1/principals/{id}", id)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body))));
    }
}
