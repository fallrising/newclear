package com.fallrising.cms.media.web;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.service.MediaService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;

@RestController
public class MediaController {

    private final MediaService media;

    public MediaController(MediaService media) {
        this.media = media;
    }

    @PostMapping(path = "/api/v1/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "altText", required = false) String altText,
            HttpServletRequest request)
            throws IOException {
        IdentityRequest identity = back(request);
        MediaAsset asset = media.upload(
                identity.principal(),
                identity.surface(),
                file.getBytes(),
                file.getOriginalFilename(),
                title,
                altText);
        return media.json(asset, false);
    }

    @GetMapping("/api/v1/media")
    public Map<String, Object> list(HttpServletRequest request) {
        IdentityRequest identity = back(request);
        return Map.of(
                "items",
                media.list(identity.principal(), identity.surface()).stream()
                        .map(asset -> media.json(asset, false))
                        .toList());
    }

    @GetMapping("/api/v1/media/quota")
    public Map<String, Object> quota(HttpServletRequest request) {
        IdentityRequest identity = back(request);
        return media.quota(identity.principal(), identity.surface());
    }

    @GetMapping("/api/v1/media/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = back(request);
        media.list(identity.principal(), identity.surface());
        return media.json(media.get(id), false);
    }

    @DeleteMapping("/api/v1/media/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = back(request);
        media.softDelete(identity.principal(), identity.surface(), id);
    }

    @GetMapping("/api/v1/media/{id}/file/{variant}")
    public ResponseEntity<byte[]> privateFile(
            @PathVariable UUID id, @PathVariable String variant, HttpServletRequest request) {
        IdentityRequest identity = back(request);
        byte[] body = media.privateBytes(identity.principal(), identity.surface(), id, variant);
        return file(body, variant, false);
    }

    @GetMapping("/api/v1/public/media/{id}/file/{variant}")
    public ResponseEntity<byte[]> publicFile(@PathVariable UUID id, @PathVariable String variant) {
        byte[] body = media.publicBytes(id, variant);
        return file(body, variant, true);
    }

    @GetMapping("/api/v1/public/media/{id}")
    public Map<String, Object> publicMeta(@PathVariable UUID id) {
        if (!media.publiclyReadable(id)) {
            throw com.fallrising.cms.media.MediaException.notFound();
        }
        return media.json(media.get(id), true);
    }

    private static IdentityRequest back(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        if (identity.surface() == Surface.FRONT) {
            throw IdentityException.surfaceForbidden(CmsAction.MANAGE_MEDIA.wire(), null, Surface.FRONT.wire());
        }
        return identity;
    }

    private static ResponseEntity<byte[]> file(byte[] body, String variant, boolean publicChannel) {
        MediaType type = "original".equals(variant) ? MediaType.APPLICATION_OCTET_STREAM : MediaType.IMAGE_JPEG;
        if (body.length >= 3 && (body[0] & 0xFF) == 0xFF && (body[1] & 0xFF) == 0xD8) {
            type = MediaType.IMAGE_JPEG;
        } else if (body.length >= 8 && (body[0] & 0xFF) == 0x89) {
            type = MediaType.IMAGE_PNG;
        } else if (body.length >= 4 && body[0] == '%' && body[1] == 'P') {
            type = MediaType.APPLICATION_PDF;
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(type);
        headers.setCacheControl("private, no-store");
        headers.setContentDisposition(
                ContentDisposition.inline().filename(variant, StandardCharsets.UTF_8).build());
        return new ResponseEntity<>(body, headers, HttpStatus.OK);
    }
}
