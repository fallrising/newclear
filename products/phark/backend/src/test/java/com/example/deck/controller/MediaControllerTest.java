package com.example.deck.controller;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.MediaContent;
import com.example.deck.service.MediaService;
import com.example.deck.service.MediaStorageException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class MediaControllerTest {

    private static final String REQUEST_ID = "media-controller-test";
    private static final String INTERNAL_KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private MediaService mediaService;

    @Test
    void anonymousJpegReadReturnsExactVerifiedBytesAndImmutableHeaders() throws Exception {
        byte[] bytes = new byte[] {(byte) 0xff, (byte) 0xd8, (byte) 0xff, 1, 2};
        when(mediaService.read(7L)).thenReturn(new MediaContent(7L, "image/jpeg", bytes));

        mockMvc.perform(get("/api/media/7"))
                .andExpect(status().isOk())
                .andExpect(content().bytes(bytes))
                .andExpect(content().contentType("image/jpeg"))
                .andExpect(header().longValue("Content-Length", bytes.length))
                .andExpect(header().string(
                        "Content-Disposition", "inline; filename=\"image-7.jpg\""))
                .andExpect(header().string(
                        "Cache-Control", "public, max-age=31536000, immutable"));

        verify(mediaService).read(7L);
    }

    @Test
    void pngReadUsesPngFilenameAndCanonicalType() throws Exception {
        byte[] bytes = new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47};
        when(mediaService.read(8L)).thenReturn(new MediaContent(8L, "image/png", bytes));

        mockMvc.perform(get("/api/media/8"))
                .andExpect(status().isOk())
                .andExpect(content().bytes(bytes))
                .andExpect(content().contentType("image/png"))
                .andExpect(header().string(
                        "Content-Disposition", "inline; filename=\"image-8.png\""));

        verify(mediaService).read(8L);
    }

    @Test
    void nonPositiveIdReturnsInvalidMediaIdWithRequestId() throws Exception {
        when(mediaService.read(0L)).thenThrow(new ApiException(ApiErrorCode.INVALID_MEDIA_ID));

        mockMvc.perform(get("/api/media/0").header("X-Request-ID", REQUEST_ID))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(header().string("X-Request-ID", REQUEST_ID))
                .andExpect(jsonPath("$.code").value("INVALID_MEDIA_ID"))
                .andExpect(jsonPath("$.requestId").value(REQUEST_ID))
                .andExpect(jsonPath("$.instance").value("/api/media/0"));

        verify(mediaService).read(0L);
    }

    @Test
    void nonNumericIdReturnsInvalidMediaIdWithoutServiceCall() throws Exception {
        mockMvc.perform(get("/api/media/not-a-number").header("X-Request-ID", REQUEST_ID))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(jsonPath("$.code").value("INVALID_MEDIA_ID"))
                .andExpect(jsonPath("$.requestId").value(REQUEST_ID));

        verifyNoInteractions(mediaService);
    }

    @Test
    void missingMetadataReturnsMediaNotFound() throws Exception {
        when(mediaService.read(999L)).thenThrow(new ApiException(ApiErrorCode.MEDIA_NOT_FOUND));

        mockMvc.perform(get("/api/media/999"))
                .andExpect(status().isNotFound())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(jsonPath("$.code").value("MEDIA_NOT_FOUND"))
                .andExpect(jsonPath("$.instance").value("/api/media/999"));

        verify(mediaService).read(999L);
    }

    @Test
    void storageOrIntegrityFailureReturnsRedactedInternalError() throws Exception {
        when(mediaService.read(7L)).thenThrow(new ApiException(
                ApiErrorCode.INTERNAL_ERROR,
                new MediaStorageException("Failed to read /data/media/" + INTERNAL_KEY)));

        mockMvc.perform(get("/api/media/7").header("X-Request-ID", REQUEST_ID))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(header().string("X-Request-ID", REQUEST_ID))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.requestId").value(REQUEST_ID))
                .andExpect(content().string(not(containsString("/data/media"))))
                .andExpect(content().string(not(containsString(INTERNAL_KEY))))
                .andExpect(content().string(not(containsString("MediaStorageException"))));

        verify(mediaService).read(7L);
    }

    @Test
    void unexpectedServiceContentTypeFailsClosedWithoutServingBytes() throws Exception {
        byte[] secretBytes = "private svg bytes".getBytes();
        when(mediaService.read(7L))
                .thenReturn(new MediaContent(7L, "image/svg+xml", secretBytes));

        mockMvc.perform(get("/api/media/7").header("X-Request-ID", REQUEST_ID))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentType("application/problem+json"))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.requestId").value(REQUEST_ID))
                .andExpect(content().string(not(containsString("image/svg+xml"))))
                .andExpect(content().string(not(containsString("private svg bytes"))));

        verify(mediaService).read(7L);
    }
}
