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
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 02 BQ-10: the public list's ref.<field> follows the published copy, not the working copy. */
@SpringBootTest
@AutoConfigureMockMvc
class PublicRefFilterApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ10_photoMovedToAnotherAlbumStaysInThePublishedAlbumUntilRepublished() throws Exception {
        ApiFixture api = new ApiFixture(mockMvc, mapper);
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String first = api.create(op, "album", Map.of("title", ApiFixture.token("First "))).get("id").asText();
        String second = api.create(op, "album", Map.of("title", ApiFixture.token("Second "))).get("id").asText();
        api.action(op, first, "publish").andExpect(status().isOk());
        api.action(op, second, "publish").andExpect(status().isOk());
        JsonNode photo = api.create(op, "photo", Map.of("title", "Moving", "album", first));
        String id = photo.get("id").asText();
        api.action(op, id, "publish").andExpect(status().isOk());
        api.patchEntry(op, id, api.work(op, id).get("version").asInt(), Map.of("title", "Moving", "album", second))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", first))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(1))
                .andExpect(jsonPath("$.items[0].id").value(id));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", second))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.total").value(0));

        api.action(op, id, "publish").andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", second))
                .andExpect(jsonPath("$.total").value(1));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", first))
                .andExpect(jsonPath("$.total").value(0));
    }
}
