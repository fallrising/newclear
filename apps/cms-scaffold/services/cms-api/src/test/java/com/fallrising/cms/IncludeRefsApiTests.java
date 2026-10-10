package com.fallrising.cms;

import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** G-10: include=refs on the work list and GET /entries/{id}; 02 §6 restricted targets. */
@SpringBootTest
@AutoConfigureMockMvc
class IncludeRefsApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @Value("${cms.identity.seed-password}")
    String password;

    ApiFixture api;

    @BeforeEach
    void setUp() {
        api = new ApiFixture(mockMvc, mapper);
    }

    @Test
    void G10_listAndSingleReadExpandRefs() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = ApiFixture.token("r");
        String album = api.create(op, "album", Map.of("title", token + " album")).get("id").asText();
        String photo = api.create(op, "photo", Map.of("title", token + " photo", "album", album)).get("id").asText();

        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("q", token).param("include", "refs")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].refs.album.id").value(album))
                .andExpect(jsonPath("$.items[0].refs.album.contentType").value("album"))
                .andExpect(jsonPath("$.items[0].refs.album.title").value(token + " album"))
                .andExpect(jsonPath("$.items[0].refs.album.publicationState").value("draft"));
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("q", token)))
                .andExpect(jsonPath("$.items[0].refs").doesNotExist());
        mockMvc.perform(op.apply(get("/api/v1/entries/{id}", photo).param("include", "refs")))
                .andExpect(jsonPath("$.refs.album.title").value(token + " album"));
    }

    @Test
    void G10_targetsTheCallerCannotReadAreRestricted() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String token = ApiFixture.token("r");
        String album = api.create(op, "album", Map.of("title", token + " secret album")).get("id").asText();
        String photo = api.create(op, "photo", Map.of("title", token + " photo", "album", album)).get("id").asText();

        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        TestSession photoOnly = api.principalWithRole(admin, "editor", List.of("photo"), TestSession.BACK);
        mockMvc.perform(photoOnly.apply(get("/api/v1/entries/{id}", photo).param("include", "refs")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refs.album.id").value(album))
                .andExpect(jsonPath("$.refs.album.restricted").value(true))
                .andExpect(jsonPath("$.refs.album.title").doesNotExist());
    }

    @Test
    void G10_unknownIncludeValueIs400() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("include", "refs,everything")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }
}
