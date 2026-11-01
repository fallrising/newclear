package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** B-07: every state change and governance action in 02 §4.6 writes an audit event (read back via GET /admin/audit). */
@SpringBootTest
@AutoConfigureMockMvc
class AuditTrailApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B07_entryLifecycleIsAudited() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String id = json(mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("slug", token(), "payload", Map.of("title", "Audited")))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        for (String step : List.of("publish", "unpublish", "publish", "archive", "restore")) {
            mockMvc.perform(op.apply(post("/api/v1/entries/{id}/" + step, id))).andExpect(status().isOk());
        }
        mockMvc.perform(op.apply(post("/api/v1/entries/{id}/revisions/1/revert", id))).andExpect(status().isOk());
        mockMvc.perform(op.apply(delete("/api/v1/entries/{id}", id))).andExpect(status().isNoContent());

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(countOk(admin, "entry.create", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.publish", id)).isEqualTo(2);
        assertThat(countOk(admin, "entry.unpublish", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.archive", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.restore", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.revert", id)).isEqualTo(1);
        assertThat(countOk(admin, "entry.soft_delete", id)).isEqualTo(1);
    }

    @Test
    void B07_schemaSettingsMediaAndRoleChangesAreAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        List<String> actions = List.of("type.create", "type.disable", "type.enable", "navigation.publish", "role.permissions_update");
        Map<String, Long> before = new java.util.HashMap<>();
        for (String action : actions) before.put(action, countOk(admin, action, null));

        String key = "audit_" + UUID.randomUUID().toString().substring(0, 8);
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(Map.of("key", key, "fields", List.of(Map.of("key", "title"))))))
                .andExpect(status().isCreated());
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/{key}/disable", key))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(post("/api/v1/admin/content-types/{key}/enable", key))).andExpect(status().isOk());
        mockMvc.perform(admin.apply(post("/api/v1/admin/navigation/front.primary/publish"))).andExpect(status().isOk());
        JsonNode current = json(mockMvc.perform(admin.apply(get("/api/v1/roles/editor/permissions")))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("items");
        List<JsonNode> same = new ArrayList<>();
        current.forEach(p -> same.add(((ObjectNode) p.deepCopy()).without("id")));
        mockMvc.perform(admin.apply(put("/api/v1/roles/editor/permissions"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(same)))
                .andExpect(status().isNoContent());
        for (String action : actions) {
            assertThat(countOk(admin, action, null)).as(action).isEqualTo(before.get(action) + 1);
        }

        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        BufferedImage image = new BufferedImage(4, 4, BufferedImage.TYPE_INT_RGB);
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        ImageIO.write(image, "png", png);
        String mediaId = json(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "a.png", "image/png", png.toByteArray()))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        mockMvc.perform(op.apply(delete("/api/v1/media/{id}", mediaId))).andExpect(status().is2xxSuccessful());
        admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(countOk(admin, "media.delete", mediaId)).isEqualTo(1);
    }

    @Test
    void B07_deniedGovernanceIsAudited() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        long before = count(admin, "manage_types", null, "denied");
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/admin/content-types"))).andExpect(status().isForbidden());
        admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        assertThat(count(admin, "manage_types", null, "denied")).isEqualTo(before + 1);
    }

    private long countOk(TestSession admin, String action, String targetId) throws Exception {
        return count(admin, action, targetId, "ok");
    }

    private long count(TestSession admin, String action, String targetId, String outcome) throws Exception {
        var request = get("/api/v1/admin/audit").param("action", action).param("outcome", outcome);
        if (targetId != null) request.param("targetId", targetId);
        return json(mockMvc.perform(admin.apply(request)).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("total").asLong();
    }

    private JsonNode json(String body) throws Exception {
        return mapper.readTree(body);
    }

    private static String token() {
        return "a" + UUID.randomUUID().toString().substring(0, 8);
    }
}
