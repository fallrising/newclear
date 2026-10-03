package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ErrorEnvelopeTests {

    @Autowired
    MockMvc mockMvc;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void B14_malformedJsonIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_malformedUuidPathIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/entries/not-a-uuid")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_malformedRefFilterIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/content-types/photo/entries").param("ref.album", "nope")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/public/content-types/photo/entries").param("ref.album", "nope"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_wrongMethodIsMethodNotAllowed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(put("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error.code").value("METHOD_NOT_ALLOWED"));
    }

    @Test
    void B14_unknownRouteIsRouteNotFound() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(get("/api/v1/no-such-route")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("ROUTE_NOT_FOUND"));
    }

    @Test
    void B14_wrongContentTypeIsMediaTypeNotSupported() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + UUID.randomUUID()))
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("x"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("MEDIA_TYPE_NOT_SUPPORTED"));
    }

    @Test
    void B14_uploadWithoutFileIsValidationFailed() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        mockMvc.perform(op.apply(multipart("/api/v1/media").param("title", "x")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_unknownPrincipalStatusIsValidationFailed() throws Exception {
        TestSession admin = TestSession.login(mockMvc, "seed-admin", password, TestSession.ADMIN);
        MvcResult me = mockMvc.perform(admin.apply(get("/api/v1/auth/me"))).andExpect(status().isOk()).andReturn();
        String id = me.getResponse().getContentAsString().replaceAll("(?s).*\"principal\":\\{\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(admin.apply(patch("/api/v1/principals/" + id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"bogus\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void B14_filterErrorEchoesRequestId() throws Exception {
        mockMvc.perform(get("/api/v1/auth/me").header("X-Request-Id", "bw0-request-id"))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string("X-Request-Id", "bw0-request-id"))
                .andExpect(jsonPath("$.requestId").value("bw0-request-id"))
                .andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
    }

    @Test
    void B14_controllerErrorEchoesRequestId() throws Exception {
        mockMvc.perform(get("/api/v1/public/content-types/album/entries/" + UUID.randomUUID())
                        .header("X-Request-Id", "bw0-request-id-2"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.requestId").value("bw0-request-id-2"))
                .andExpect(jsonPath("$.error.code").value("ENTRY_NOT_FOUND"))
                .andExpect(jsonPath("$.error.action").doesNotExist());
    }

    @Test
    void B14_staleVersionIsVersionConflict() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        MvcResult created = mockMvc.perform(op.apply(post("/api/v1/content-types/album/entries"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"bw0-%s\",\"payload\":{\"title\":\"BW0\"}}".formatted(UUID.randomUUID())))
                .andExpect(status().isCreated())
                .andReturn();
        String id = created.getResponse().getContentAsString().replaceAll("(?s).*\"id\":\"([^\"]+)\".*", "$1");
        mockMvc.perform(op.apply(patch("/api/v1/entries/" + id))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"version\":99,\"payload\":{\"title\":\"Stale\"}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("VERSION_CONFLICT"));
    }
}
