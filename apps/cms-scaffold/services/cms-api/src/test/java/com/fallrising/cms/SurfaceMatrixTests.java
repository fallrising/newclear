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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

/**
 * 02 §6: every endpoint added after BW0 is denied on each surface where it does not belong, and to callers without
 * the permission. One row per (account, surface); each cell is the expected "status code" of one endpoint. Rows run
 * one after another because a new login of the same account revokes its earlier session.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SurfaceMatrixTests {

    static final String UNAUTH = "401 UNAUTHENTICATED";
    static final String SURFACE = "403 SURFACE_FORBIDDEN";
    static final String FORBIDDEN = "403 FORBIDDEN";

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    record Row(String username, String origin, Map<String, String> expected) {}

    @Test
    void BW4_newEndpointsAreDeniedOnEverySurfaceWhereTheyDoNotBelong() throws Exception {
        TestSession operator = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String album = new ApiFixture(mockMvc, mapper).create(operator, "album", Map.of("title", "Matrix")).get("id").asText();
        String anyId = UUID.randomUUID().toString();
        Map<String, Supplier<MockHttpServletRequestBuilder>> endpoints = new LinkedHashMap<>();
        endpoints.put("listAssignablePrincipals", () -> get("/api/v1/principals/assignable").param("contentType", "album"));
        endpoints.put("batchPatchEntries", () -> post("/api/v1/entries:batch-patch").contentType(MediaType.APPLICATION_JSON)
                .content("{\"items\":[{\"id\":\"" + album + "\",\"version\":1,\"payload\":{\"title\":\"x\"}}]}"));
        endpoints.put("requestPublish", () -> post("/api/v1/entries/{id}/publish-request", album));
        endpoints.put("cancelPublishRequest", () -> delete("/api/v1/entries/{id}/publish-request", album));
        endpoints.put("getAuditEvent", () -> get("/api/v1/admin/audit/{id}", anyId));
        endpoints.put("listMyEntries", () -> get("/api/v1/me/content-types/pet/entries"));
        endpoints.put("getMyEntry", () -> get("/api/v1/me/entries/{id}", anyId));
        endpoints.put("createMyEntry", () -> post("/api/v1/me/content-types/appointment_request/entries")
                .contentType(MediaType.APPLICATION_JSON).content("{\"payload\":{\"reason\":\"x\"}}"));
        endpoints.put("getAuditSettings", () -> get("/api/v1/admin/settings/audit"));
        endpoints.put("patchAuditSettings", () -> patch("/api/v1/admin/settings/audit")
                .contentType(MediaType.APPLICATION_JSON).content("{\"retentionDays\":30}"));

        List<Row> rows = List.of(
                new Row(null, TestSession.ADMIN, all(endpoints, UNAUTH)),
                new Row("seed-member-clinic", TestSession.FRONT, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", SURFACE, "requestPublish", SURFACE,
                        "cancelPublishRequest", SURFACE, "getAuditEvent", SURFACE, "getAuditSettings", SURFACE,
                        "patchAuditSettings", SURFACE)),
                new Row("seed-editor-clinic", TestSession.BACK, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", FORBIDDEN, "requestPublish", FORBIDDEN,
                        "cancelPublishRequest", FORBIDDEN, "getAuditEvent", SURFACE, "listMyEntries", SURFACE,
                        "getMyEntry", SURFACE, "createMyEntry", SURFACE, "getAuditSettings", SURFACE,
                        "patchAuditSettings", SURFACE)),
                new Row("seed-editor-clinic", TestSession.ADMIN, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", FORBIDDEN, "requestPublish", FORBIDDEN,
                        "cancelPublishRequest", FORBIDDEN, "getAuditEvent", FORBIDDEN, "listMyEntries", SURFACE,
                        "getMyEntry", SURFACE, "createMyEntry", SURFACE, "getAuditSettings", FORBIDDEN,
                        "patchAuditSettings", FORBIDDEN)),
                new Row("seed-admin", TestSession.FRONT, cells(
                        "listAssignablePrincipals", FORBIDDEN, "batchPatchEntries", SURFACE, "requestPublish", SURFACE,
                        "cancelPublishRequest", SURFACE, "getAuditEvent", SURFACE, "createMyEntry", FORBIDDEN,
                        "getAuditSettings", SURFACE, "patchAuditSettings", SURFACE)),
                new Row("seed-admin", TestSession.BACK, cells(
                        "getAuditEvent", SURFACE, "listMyEntries", SURFACE, "getMyEntry", SURFACE, "createMyEntry", SURFACE,
                        "getAuditSettings", SURFACE, "patchAuditSettings", SURFACE)));

        List<String> mismatches = new ArrayList<>();
        for (Row row : rows) {
            TestSession session = row.username() == null ? null
                    : TestSession.login(mockMvc, row.username(), password, row.origin());
            for (Map.Entry<String, String> cell : row.expected().entrySet()) {
                MockHttpServletRequestBuilder request = endpoints.get(cell.getKey()).get();
                MvcResult result = mockMvc.perform(session == null ? request.header("Origin", row.origin())
                        : session.apply(request)).andReturn();
                String actual = result.getResponse().getStatus() + " " + code(result);
                if (!actual.equals(cell.getValue())) {
                    mismatches.add(row.username() + " @ " + row.origin() + " " + cell.getKey() + ": expected "
                            + cell.getValue() + ", got " + actual);
                }
            }
        }
        assertThat(mismatches).isEmpty();
    }

    private String code(MvcResult result) throws Exception {
        JsonNode body = mapper.readTree(result.getResponse().getContentAsString());
        return body.at("/error/code").asText();
    }

    private static Map<String, String> all(Map<String, ?> endpoints, String expected) {
        Map<String, String> cells = new LinkedHashMap<>();
        endpoints.keySet().forEach(name -> cells.put(name, expected));
        return cells;
    }

    private static Map<String, String> cells(String... pairs) {
        Map<String, String> cells = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) cells.put(pairs[i], pairs[i + 1]);
        return cells;
    }
}
