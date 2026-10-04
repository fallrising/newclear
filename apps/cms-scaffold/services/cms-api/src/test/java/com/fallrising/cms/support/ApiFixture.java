package com.fallrising.cms.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Small HTTP helpers shared by the BW2 API tests. */
public record ApiFixture(MockMvc mockMvc, ObjectMapper mapper) {

    public static String token(String prefix) {
        return prefix + UUID.randomUUID().toString().substring(0, 8);
    }

    public JsonNode json(ResultActions result) throws Exception {
        return mapper.readTree(result.andReturn().getResponse().getContentAsString());
    }

    /** Creates an entry (201) and returns its JSON. */
    public JsonNode create(TestSession session, String type, Map<String, Object> payload) throws Exception {
        return json(mockMvc.perform(session.apply(post("/api/v1/content-types/{type}/entries", type))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("slug", token("s"), "payload", payload))))
                .andExpect(status().isCreated()));
    }

    public ResultActions patchEntry(TestSession session, String id, int version, Map<String, Object> payload) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("version", version);
        body.put("payload", payload);
        return mockMvc.perform(session.apply(patch("/api/v1/entries/{id}", id))
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)));
    }

    public ResultActions action(TestSession session, String id, String action) throws Exception {
        return mockMvc.perform(session.apply(post("/api/v1/entries/{id}/" + action, id)));
    }

    public JsonNode work(TestSession session, String id) throws Exception {
        return json(mockMvc.perform(session.apply(get("/api/v1/entries/{id}", id))).andExpect(status().isOk()));
    }

    /**
     * Creates a principal with one role limited to contentTypes and logs it in on the given surface. The password is
     * random per test run and is not a seed password.
     */
    public TestSession principalWithRole(TestSession admin, String role, List<String> contentTypes, String origin) throws Exception {
        String username = token("u");
        String password = "Pw-" + UUID.randomUUID() + "-Aa1";
        JsonNode created = json(mockMvc.perform(admin.apply(post("/api/v1/principals"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("username", username, "displayName", username,
                                "temporaryPassword", password))))
                .andExpect(status().isCreated()));
        String id = created.get("id").asText();
        mockMvc.perform(admin.apply(put("/api/v1/principals/{id}/roles", id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(List.of(Map.of("code", role, "contentTypeCodes", contentTypes)))))
                .andExpect(status().is2xxSuccessful());
        return TestSession.login(mockMvc, username, password, origin);
    }
}
