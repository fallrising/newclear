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
import java.util.Map;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PublishRequestApiTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired com.fallrising.cms.identity.store.IdentityStore identity;
    @Value("${cms.identity.seed-password}") String password;

    @Test void actualRequestTransitionsClaimVersionsAndRepeatedCallsAreReadOnly() throws Exception {
        var op = TestSession.login(mvc, "seed-operator-album", password, TestSession.BACK);
        var created = mvc.perform(op.apply(post("/api/v1/content-types/album/entries"))
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(Map.of("payload", Map.of("title", "Request")))))
                .andExpect(status().isCreated()).andReturn();
        var body = mapper.readTree(created.getResponse().getContentAsString());
        var id = body.get("id").asText();
        var first = mvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.publishRequestedAt").isNotEmpty()).andReturn();
        var at = mapper.readTree(first.getResponse().getContentAsString()).get("publishRequestedAt").asText();
        mvc.perform(op.apply(post("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.publishRequestedAt").value(at));
        mvc.perform(op.apply(delete("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(3))
                .andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
        mvc.perform(op.apply(delete("/api/v1/entries/{id}/publish-request", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(3));
    }

    @Test void cleanPublicationWithAnOpenRequestClearsOnlyTheRequest() throws Exception {
        var op = TestSession.login(mvc, "seed-operator-album", password, TestSession.BACK);
        var api = new com.fallrising.cms.support.ApiFixture(mvc, mapper);
        var id = api.create(op, "album", Map.of("title", "published")).get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
        api.patchEntry(op, id, 2, Map.of("title", "dirty")).andExpect(status().isOk());
        api.action(op, id, "publish-request").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(4));
        api.patchEntry(op, id, 4, Map.of("title", "published")).andExpect(status().isOk())
                .andExpect(jsonPath("$.dirty").value(false)).andExpect(jsonPath("$.publishRequestedAt").isNotEmpty());
        api.action(op, id, "publish").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(6))
                .andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
        api.action(op, id, "publish").andExpect(status().isOk()).andExpect(jsonPath("$.version").value(6));
        mvc.perform(op.apply(get("/api/v1/entries/{id}/revisions", id)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
        org.assertj.core.api.Assertions.assertThat(identity.listAudits("entry.publish", java.util.UUID.fromString(id))).hasSize(1);
        org.assertj.core.api.Assertions.assertThat(identity.listAudits("entry.publish_request_cancel", java.util.UUID.fromString(id))).hasSize(1);
    }

    @Test void requestFilteringPermissionsAndLifecyclePreserveExpectedMetadata() throws Exception {
        var op = TestSession.login(mvc, "seed-operator-album", password, TestSession.BACK);
        var api = new com.fallrising.cms.support.ApiFixture(mvc, mapper);
        var token = com.fallrising.cms.support.ApiFixture.token("req");
        var id = api.create(op, "album", Map.of("title", token)).get("id").asText();
        api.create(op, "album", Map.of("title", token + " plain"));
        api.action(op, id, "publish-request").andExpect(status().isOk());
        api.patchEntry(op, id, 2, Map.of("title", token + " edited")).andExpect(status().isOk())
                .andExpect(jsonPath("$.publishRequestedAt").isNotEmpty());
        mvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("publishRequested", "true")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(1));
        mvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("q", token).param("publishRequested", "false")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.total").value(2));
        mvc.perform(op.apply(get("/api/v1/content-types/album/entries").param("publishRequested", "maybe")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        var clinic = TestSession.login(mvc, "seed-editor-clinic", password, TestSession.BACK);
        api.action(clinic, id, "publish-request").andExpect(status().isForbidden());
        mvc.perform(clinic.apply(delete("/api/v1/entries/{id}/publish-request", id))).andExpect(status().isForbidden());
        api.action(op, id, "publish").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
        api.action(op, id, "publish-request").andExpect(status().isConflict());
        api.patchEntry(op, id, 4, Map.of("title", token + " dirty")).andExpect(status().isOk());
        api.action(op, id, "publish-request").andExpect(status().isOk());
        api.action(op, id, "unpublish").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
        api.action(op, id, "publish-request").andExpect(status().isOk());
        api.action(op, id, "archive").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
        api.action(op, id, "publish-request").andExpect(status().isConflict());
        api.action(op, id, "restore").andExpect(status().isOk()).andExpect(jsonPath("$.publishRequestedAt").value(org.hamcrest.Matchers.nullValue()));
    }
}
