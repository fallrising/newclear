package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.hamcrest.Matchers.equalTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** BW1b list queries through the HTTP API (02 §4.1). Each test creates its own entries under a unique token. */
@SpringBootTest
@AutoConfigureMockMvc
class ListQueryApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    IdentityStore identityStore;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void G02_workListPagesAndCountsAllMatches() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        for (int i = 1; i <= 5; i++) {
            create(op, "album", Map.of("title", token + " album " + i));
        }
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries")
                        .param("q", token).param("size", "2").param("page", "2").param("sort", "title")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(5))
                .andExpect(jsonPath("$.page").value(2))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.offset").value(2))
                .andExpect(jsonPath("$.limit").value(2))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " album 3", token + " album 4"))));
    }

    @Test
    void G02_largePageKeepsOffsetPositiveAndTotalUnchanged() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        create(op, "album", Map.of("title", token));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries")
                        .param("q", token).param("page", "2147483647").param("size", "100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.offset").value(214748364600L))
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    void G02_workListDefaultStatesLeaveOutArchived() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        create(op, "album", Map.of("title", token + " kept"));
        String archived = create(op, "album", Map.of("title", token + " archived"));
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/archive", archived))).andExpect(status().isOk());

        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token)))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " kept"))));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("state", "archived")))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " archived"))));
    }

    @Test
    void G02_workListFiltersByFilterableField() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        create(op, "album", Map.of("title", token + " open", "visibility", "public"));
        create(op, "album", Map.of("title", token + " hidden", "visibility", "unlisted"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/album/entries")
                        .param("q", token).param("filter.visibility", "unlisted")))
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].title").value(token + " hidden"));
    }

    @Test
    void G02_invalidListParametersAre400() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        for (String[] bad : List.of(
                new String[] {"size", "0"},
                new String[] {"page", "x"},
                new String[] {"state", "gone"},
                new String[] {"sort", "cover"},
                new String[] {"filter.title", "a"},
                new String[] {"ref.album", "not-a-uuid"})) {
            mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param(bad[0], bad[1])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/public/content-types/album/entries").param("state", "draft"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("AUDIENCE_PARAM_REJECTED"));
    }

    @Test
    void G02_listGuardsForSessionSurfaceAndUnknownType() throws Exception {
        mockMvc.perform(get("/api/v1/content-types/album/entries").header("Origin", TestSession.BACK))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        TestSession front = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.FRONT);
        mockMvc.perform(front.apply(get("/api/v1/content-types/album/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        TestSession back = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/content-types/nope/entries")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("CONTENT_TYPE_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/content-types/nope/entries"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"));
    }

    @Test
    void B10_deniedWorkListReturns403BeforeValidatingParameters() throws Exception {
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(member.apply(get("/api/v1/content-types/pet/entries").param("size", "0")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
        mockMvc.perform(member.apply(get("/api/v1/content-types/pet/entries")
                        .param("state", "published").param("size", "0")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void G02_publicPhotosFollowSortFieldAndSortParameter() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = token();
        String album = create(op, "album", Map.of("title", token, "visibility", "public"), token);
        publish(op, album);
        for (int rank : List.of(3, 1, 2)) {
            publish(op, create(op, "photo", Map.of("title", token + " p" + rank, "album", album, "sortOrder", rank)));
        }
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", album))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " p1", token + " p2", token + " p3"))));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", album)
                        .param("sort", "-sortOrder").param("size", "2"))
                .andExpect(jsonPath("$.total").value(3))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of(token + " p3", token + " p2"))));
    }

    @Test
    void B10_memberListsOnlyOwnPetsOnBothSurfaces() throws Exception {
        TestSession front = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.FRONT);
        mockMvc.perform(front.apply(get("/api/v1/public/content-types/pet/entries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))));

        TestSession back = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(back.apply(get("/api/v1/content-types/pet/entries").param("state", "published")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[*].title").value(equalTo(List.of("Leo"))));
        mockMvc.perform(back.apply(get("/api/v1/content-types/pet/entries")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    @Test
    void B10_unscopedGrantListsEveryPet() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-clinic", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/pet/entries").param("sort", "title")))
                .andExpect(jsonPath("$.items[*].title").value(org.hamcrest.Matchers.hasItems("Basil", "Jewel", "Leo")));
    }

    @Test
    void B10_predicateOnFieldWithoutIndexRowsIsRejected() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        UUID memberRole = identityStore.findRoleByCode("member").orElseThrow().id();
        var permissionsBefore = identityStore.permissionsOfRole(memberRole);
        String notIndexed = "{\"type\":\"fieldEquals\",\"field\":\"notes\",\"value\":\"$currentPrincipalId\"}";
        String typeless = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        for (String body : List.of(
                "[{\"action\":\"read_published\",\"contentTypeCode\":\"pet\",\"predicateJson\":%s}]".formatted(mapper.writeValueAsString(notIndexed)),
                "[{\"action\":\"read_published\",\"predicateJson\":%s}]".formatted(mapper.writeValueAsString(typeless)))) {
            mockMvc.perform(admin.apply(put("/api/v1/roles/member/permissions")
                            .contentType(MediaType.APPLICATION_JSON).content(body)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
            org.assertj.core.api.Assertions.assertThat(identityStore.permissionsOfRole(memberRole))
                    .containsExactlyElementsOf(permissionsBefore);
        }
    }

    private String create(TestSession session, String type, Map<String, Object> payload) throws Exception {
        return create(session, type, payload, null);
    }

    private String create(TestSession session, String type, Map<String, Object> payload, String slug) throws Exception {
        String body = mapper.writeValueAsString(Map.of("slug", slug == null ? token() : slug, "payload", payload));
        String json = mockMvc.perform(session.apply(post("/api/v1/content-types/{type}/entries", type)
                        .contentType(MediaType.APPLICATION_JSON).content(body)))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        JsonNode node = mapper.readTree(json);
        return node.get("id").asText();
    }

    private void publish(TestSession session, String id) throws Exception {
        mockMvc.perform(session.apply(post("/api/v1/entries/{id}/publish", id))).andExpect(status().isOk());
    }

    private static String token() {
        return "t" + UUID.randomUUID().toString().substring(0, 8);
    }
}
