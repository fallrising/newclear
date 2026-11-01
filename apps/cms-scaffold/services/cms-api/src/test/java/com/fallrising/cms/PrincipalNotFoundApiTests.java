package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Instant;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** 02 BQ-06: every /principals/{id} operation answers 404 PRINCIPAL_NOT_FOUND for an id that is not a principal. */
@SpringBootTest
@AutoConfigureMockMvc
class PrincipalNotFoundApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    IdentityStore identity;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ06_unknownPrincipalIdIs404OnEveryOperation() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        String id = UUID.randomUUID().toString();
        List<Principal> principals = identity.listPrincipals();
        var events = identity.listAudits(null, null);
        assertNotFound(admin, id);
        assertThat(identity.listPrincipals()).isEqualTo(principals);
        assertThat(identity.listAudits(null, null)).isEqualTo(events);
        assertThat(identity.rolesOf(UUID.fromString(id))).isEmpty();
        assertThat(identity.findPasswordCredential(UUID.fromString(id))).isEmpty();
    }

    private void assertNotFound(TestSession admin, String id) throws Exception {
        Map<String, MockHttpServletRequestBuilder> operations = operations(id);
        List<String> mismatches = new ArrayList<>();
        for (Map.Entry<String, MockHttpServletRequestBuilder> operation : operations.entrySet()) {
            MvcResult result = mockMvc.perform(admin.apply(operation.getValue())).andReturn();
            String actual = result.getResponse().getStatus() + " "
                    + mapper.readTree(result.getResponse().getContentAsString()).at("/error/code").asText();
            if (!actual.equals("404 PRINCIPAL_NOT_FOUND")) mismatches.add(operation.getKey() + ": " + actual);
        }
        assertThat(mismatches).isEmpty();
    }

    @Test
    void BQ06_deletedPrincipalIsNotFoundOnEveryOperation() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        Instant now = Instant.now();
        UUID id = UUID.randomUUID();
        String name = "deleted-" + id.toString().substring(0, 8);
        identity.insertPrincipal(new Principal(id, name, name, null, PrincipalStatus.ACTIVE, 0, null, null,
                now, now, now));
        var events = identity.listAudits(null, null);
        assertNotFound(admin, id.toString());
        assertThat(identity.listAudits(null, null)).isEqualTo(events);
    }

    @Test
    void BQ06_authorizationPrecedesUnknownPrincipalLookup() throws Exception {
        String id = UUID.randomUUID().toString();
        for (MockHttpServletRequestBuilder operation : operations(id).values()) {
            mockMvc.perform(operation.header("Origin", TestSession.ADMIN))
                    .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        }
        for (String[] row : List.of(new String[]{"seed-admin", TestSession.FRONT, "SURFACE_FORBIDDEN"},
                new String[]{"seed-admin", TestSession.BACK, "SURFACE_FORBIDDEN"},
                new String[]{"seed-editor-clinic", TestSession.ADMIN, "FORBIDDEN"})) {
            TestSession session = TestSession.login(mockMvc, row[0], password, row[1]);
            for (MockHttpServletRequestBuilder operation : operations(id).values()) {
                mockMvc.perform(session.apply(operation)).andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.error.code").value(row[2]));
            }
        }
    }

    @Test
    void BQ06_malformedIdsRemain400AndDisabledPrincipalRemainsVisible() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        for (MockHttpServletRequestBuilder operation : operations("not-a-uuid").values()) {
            mockMvc.perform(admin.apply(operation)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        Instant now = Instant.now();
        UUID id = UUID.randomUUID();
        String name = "disabled-" + id.toString().substring(0, 8);
        identity.insertPrincipal(new Principal(id, name, name, null, PrincipalStatus.DISABLED, 0, null, null,
                now, now, null));
        mockMvc.perform(admin.apply(get("/api/v1/principals/{id}", id))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(get("/api/v1/principals/{id}/effective-permissions", id))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(post("/api/v1/principals/{id}/unlock", id)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("ACCOUNT_DISABLED"));
    }

    private Map<String, MockHttpServletRequestBuilder> operations(String id) {
        Map<String, MockHttpServletRequestBuilder> operations = new LinkedHashMap<>();
        operations.put("getPrincipal", get("/api/v1/principals/{id}", id));
        operations.put("patchPrincipal", patch("/api/v1/principals/{id}", id)
                .contentType(MediaType.APPLICATION_JSON).content("{\"displayName\":\"Nobody\"}"));
        operations.put("disablePrincipal", post("/api/v1/principals/{id}/disable", id));
        operations.put("unlockPrincipal", post("/api/v1/principals/{id}/unlock", id));
        operations.put("replacePrincipalRoles", put("/api/v1/principals/{id}/roles", id)
                .contentType(MediaType.APPLICATION_JSON).content("[{\"code\":\"member\"}]"));
        operations.put("setPrincipalPassword", post("/api/v1/principals/{id}/password", id)
                .contentType(MediaType.APPLICATION_JSON).content("{}"));
        operations.put("effectivePermissions", get("/api/v1/principals/{id}/effective-permissions", id));

        return operations;
    }
}
