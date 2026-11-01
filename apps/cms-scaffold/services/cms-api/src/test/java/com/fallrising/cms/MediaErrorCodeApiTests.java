package com.fallrising.cms;

import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.UUID;
import com.fallrising.cms.media.store.MediaStore;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doReturn;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** 02 BQ-07: media error codes are upper case like every other ErrorCode. */
@SpringBootTest
@AutoConfigureMockMvc
class MediaErrorCodeApiTests {

    @Autowired
    MockMvc mockMvc;

    @Autowired
    ObjectMapper mapper;

    @MockitoSpyBean
    MediaStore store;

    @Value("${cms.identity.seed-password}")
    String password;

    @Test
    void BQ07_mediaErrorCodesAreUpperCase() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        String missing = UUID.randomUUID().toString();
        mockMvc.perform(op.apply(get("/api/v1/media/{id}", missing)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
        mockMvc.perform(get("/api/v1/public/media/{id}", missing))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
        mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "notes.txt", "text/plain", "hello".getBytes()))))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error.code").value("MEDIA_UNSUPPORTED_TYPE"));

        String id = mapper.readTree(mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "dot.png", "image/png", png()))))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString()).get("id").asText();
        mockMvc.perform(op.apply(get("/api/v1/media/{id}/file/{variant}", id, "poster")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_VARIANT_NOT_AVAILABLE"));
        mockMvc.perform(get("/api/v1/public/media/{id}", id)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
        mockMvc.perform(op.apply(delete("/api/v1/media/{id}", id))).andExpect(status().isNoContent());
        mockMvc.perform(op.apply(get("/api/v1/media/{id}/file/{variant}", id, "original")))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.error.code").value("MEDIA_GONE"));
        mockMvc.perform(get("/api/v1/public/media/{id}/file/original", id)).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error.code").value("MEDIA_NOT_FOUND"));
    }

    @Test
    void BQ07_quotaAndSizeErrorsUseUpperCaseWithoutAddingMediaRows() throws Exception {
        TestSession op = TestSession.login(mockMvc, "seed-operator-album", password, TestSession.BACK);
        MediaStore.Quota original = store.quota();
        var assets = store.listAvailable();
        long files = store.countFiles();
        long bytes = store.sumStoredBytes();
        doReturn(new MediaStore.Quota(1, original.maxLibraryBytes(), original.maxFiles(), original.maxFilesPerPrincipal()))
                .when(store).quota();
        mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "dot.png", "image/png", png()))))
                .andExpect(status().isPayloadTooLarge()).andExpect(jsonPath("$.error.code").value("MEDIA_FILE_TOO_LARGE"));
        doReturn(new MediaStore.Quota(original.maxFileBytes(), original.maxLibraryBytes(), 0, original.maxFilesPerPrincipal()))
                .when(store).quota();
        mockMvc.perform(op.apply(multipart("/api/v1/media")
                        .file(new MockMultipartFile("file", "dot.png", "image/png", png()))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.error.code").value("MEDIA_QUOTA_EXCEEDED"));
        assertThat(store.listAvailable()).isEqualTo(assets);
        assertThat(store.countFiles()).isEqualTo(files);
        assertThat(store.sumStoredBytes()).isEqualTo(bytes);
    }

    @Test
    void BQ07_authorizationStillPrecedesPrivateMediaLookup() throws Exception {
        UUID missing = UUID.randomUUID();
        mockMvc.perform(get("/api/v1/media/{id}", missing).header("Origin", TestSession.BACK))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error.code").value("UNAUTHENTICATED"));
        TestSession front = TestSession.login(mockMvc, "seed-admin", password, TestSession.FRONT);
        mockMvc.perform(front.apply(get("/api/v1/media/{id}", missing)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("SURFACE_FORBIDDEN"));
        TestSession member = TestSession.login(mockMvc, "seed-member-clinic", password, TestSession.BACK);
        mockMvc.perform(member.apply(get("/api/v1/media/{id}", missing)))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value("FORBIDDEN"));
    }

    private static byte[] png() throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(8, 8, BufferedImage.TYPE_INT_RGB), "png", out);
        return out.toByteArray();
    }
}
