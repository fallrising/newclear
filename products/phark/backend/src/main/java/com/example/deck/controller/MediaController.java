package com.example.deck.controller;

import com.example.deck.error.ApiErrorCode;
import com.example.deck.error.ApiException;
import com.example.deck.model.MediaContent;
import com.example.deck.service.MediaService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/media")
public class MediaController {

    private static final String IMMUTABLE_CACHE =
            "public, max-age=31536000, immutable";

    private final MediaService mediaService;

    public MediaController(MediaService mediaService) {
        this.mediaService = mediaService;
    }

    @GetMapping("/{mediaId}")
    public ResponseEntity<byte[]> getMedia(@PathVariable long mediaId) {
        MediaContent content = mediaService.read(mediaId);
        String extension = extension(content.contentType());
        byte[] bytes = content.bytes();

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(content.contentType()))
                .contentLength(bytes.length)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        "inline; filename=\"image-%d.%s\"".formatted(mediaId, extension))
                .header(HttpHeaders.CACHE_CONTROL, IMMUTABLE_CACHE)
                .body(bytes);
    }

    private String extension(String contentType) {
        return switch (contentType) {
            case MediaType.IMAGE_JPEG_VALUE -> "jpg";
            case MediaType.IMAGE_PNG_VALUE -> "png";
            default -> throw new ApiException(ApiErrorCode.INTERNAL_ERROR);
        };
    }
}
