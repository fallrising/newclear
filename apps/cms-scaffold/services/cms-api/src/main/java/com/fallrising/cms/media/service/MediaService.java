package com.fallrising.cms.media.service;

import com.fallrising.cms.content.PublicVisibility;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.domain.FieldRecord;
import com.fallrising.cms.content.domain.PublicationState;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.media.ImageVariants;
import com.fallrising.cms.media.MediaException;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaAttachment;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.store.MediaObjectStore;
import com.fallrising.cms.media.store.MediaStore;
import org.springframework.stereotype.Service;

import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class MediaService {

    private static final Set<String> ALLOWED = Set.of("image/jpeg", "image/png", "image/gif", "application/pdf");

    private final MediaStore store;
    private final MediaObjectStore objects;
    private final ContentStore content;
    private final AuthorizationService authorization;

    public MediaService(
            MediaStore store, MediaObjectStore objects, ContentStore content, AuthorizationService authorization) {
        this.store = store;
        this.objects = objects;
        this.content = content;
        this.authorization = authorization;
    }

    public MediaAsset upload(
            Principal principal, Surface surface, byte[] bytes, String filename, String title, String altText) {
        authorization.require(principal, CmsAction.MANAGE_MEDIA, null, null, surface);
        if (bytes == null || bytes.length == 0) {
            throw MediaException.unsupportedType();
        }
        MediaStore.Quota quota = store.quota();
        if (bytes.length > quota.maxFileBytes()) {
            throw MediaException.tooLarge();
        }
        String sniffed = sniff(bytes);
        if (sniffed == null || !ALLOWED.contains(sniffed)) {
            throw MediaException.unsupportedType();
        }
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        String ext = extension(sniffed);
        String originalKey = "media/" + id + "/original" + ext;
        objects.put(originalKey, bytes);
        List<MediaVariant> variants = new ArrayList<>();
        Integer width = null;
        Integer height = null;
        long stored = bytes.length;
        var image = sniffed.startsWith("image/") ? ImageVariants.read(bytes) : null;
        if (image != null) {
            width = image.getWidth();
            height = image.getHeight();
            var thumb = ImageVariants.fit(image, 320, 0.82f);
            String thumbKey = "media/" + id + "/thumbnail.jpg";
            objects.put(thumbKey, thumb.jpeg());
            stored += thumb.jpeg().length;
            variants.add(new MediaVariant(id, "thumbnail", "image/jpeg", thumb.jpeg().length, thumb.width(), thumb.height(), thumbKey));
            var web = ImageVariants.fit(image, 1600, 0.85f);
            String webKey = "media/" + id + "/web.jpg";
            objects.put(webKey, web.jpeg());
            stored += web.jpeg().length;
            variants.add(new MediaVariant(id, "web", "image/jpeg", web.jpeg().length, web.width(), web.height(), webKey));
        }
        variants.add(0, new MediaVariant(id, "original", sniffed, bytes.length, width, height, originalKey));
        if (store.countFiles() + 1 > quota.maxFiles()
                || store.sumStoredBytes() + stored > quota.maxLibraryBytes()
                || store.countByOwner(principal.id()) + 1 > quota.maxFilesPerPrincipal()) {
            for (MediaVariant variant : variants) {
                objects.delete(variant.objectKey());
            }
            throw MediaException.quota();
        }
        String display = title == null || title.isBlank() ? stripExt(filename) : title;
        MediaAsset asset = new MediaAsset(
                id,
                principal.id(),
                display,
                altText == null ? "" : altText,
                filename == null ? "upload" + ext : filename,
                sniffed,
                bytes.length,
                stored,
                width,
                height,
                sha256(bytes),
                "available",
                null,
                now,
                now,
                List.of());
        store.insert(asset);
        for (MediaVariant variant : variants) {
            store.insertVariant(variant);
        }
        return store.find(id).orElse(asset);
    }

    public MediaAsset get(UUID id) {
        return store.find(id).orElseThrow(MediaException::notFound);
    }

    public List<MediaAsset> list(Principal principal, Surface surface) {
        authorization.require(principal, CmsAction.MANAGE_MEDIA, null, null, surface);
        return store.listAvailable();
    }

    public MediaAsset softDelete(Principal principal, Surface surface, UUID id) {
        authorization.require(principal, CmsAction.MANAGE_MEDIA, null, null, surface);
        MediaAsset current = get(id);
        Instant now = Instant.now();
        MediaAsset deleted = new MediaAsset(
                current.id(),
                current.ownerPrincipalId(),
                current.title(),
                current.altText(),
                current.originalFilename(),
                current.contentType(),
                current.byteSize(),
                current.storedBytes(),
                current.width(),
                current.height(),
                current.checksumSha256(),
                "deleted",
                now,
                current.createdAt(),
                now,
                current.variants());
        store.update(deleted);
        return deleted;
    }

    public void replaceAttachments(UUID entryId, List<MediaAttachment> attachments) {
        store.replaceAttachments(entryId, attachments);
    }

    public boolean publiclyReadable(UUID mediaId) {
        MediaAsset asset = store.find(mediaId).orElse(null);
        if (asset == null || !asset.available()) {
            return false;
        }
        for (MediaAttachment attachment : store.attachmentsOfMedia(mediaId)) {
            Optional<EntryRecord> entry = content.findEntry(attachment.entryId());
            if (entry.isEmpty() || entry.get().deleted() || entry.get().publicationState() != PublicationState.PUBLISHED) {
                continue;
            }
            boolean allowedField = content.fieldsOf(entry.get().contentTypeId()).stream()
                    .anyMatch(f -> f.fieldKey().equals(attachment.fieldKey()) && f.publicBytes() && f.enabled());
            if (allowedField
                    && PublicVisibility.gettable(entry.get().publishedPayload())
                    && publishedRefsOk(entry.get())) {
                return true;
            }
        }
        return false;
    }

    public byte[] privateBytes(Principal principal, Surface surface, UUID id, String variant) {
        MediaAsset asset = store.find(id).orElseThrow(MediaException::notFound);
        if (!canReadPrivate(principal, surface, asset)) {
            throw IdentityException.forbidden(CmsAction.MANAGE_MEDIA.wire(), null, surface.wire());
        }
        if (!asset.available()) {
            throw MediaException.gone();
        }
        return bytes(asset, variant, false);
    }

    public byte[] publicBytes(UUID id, String variant) {
        if (!publiclyReadable(id)) {
            throw MediaException.notFound();
        }
        MediaAsset asset = get(id);
        return bytes(asset, variant, true);
    }

    public Map<String, Object> json(MediaAsset asset, boolean publicViewer) {
        Map<String, Object> variants = new LinkedHashMap<>();
        String prefix = publicViewer ? "/api/v1/public/media/" : "/api/v1/media/";
        for (MediaVariant variant : asset.variants()) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("url", prefix + asset.id() + "/file/" + variant.variant());
            item.put("width", variant.width());
            item.put("height", variant.height());
            item.put("contentType", variant.contentType());
            item.put("byteSize", variant.byteSize());
            variants.put(variant.variant(), item);
        }
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("id", asset.id().toString());
        json.put("mediaId", asset.id().toString());
        json.put("title", asset.title());
        json.put("altText", asset.altText());
        json.put("contentType", asset.contentType());
        json.put("byteSize", asset.byteSize());
        json.put("width", asset.width());
        json.put("height", asset.height());
        json.put("variants", variants);
        return json;
    }

    public Map<String, Object> quota(Principal principal, Surface surface) {
        authorization.require(principal, CmsAction.MANAGE_MEDIA, null, null, surface);
        MediaStore.Quota quota = store.quota();
        return Map.of(
                "usedFiles", store.countFiles(),
                "usedBytes", store.sumStoredBytes(),
                "maxFiles", quota.maxFiles(),
                "maxLibraryBytes", quota.maxLibraryBytes(),
                "maxFileBytes", quota.maxFileBytes());
    }

    private boolean publishedRefsOk(EntryRecord entry) {
        var type = content.findTypeByKey(entry.contentTypeKey()).orElse(null);
        if (type == null || type.publicRequiresPublishedRefs().isEmpty()) {
            return true;
        }
        Map<String, Object> payload = entry.publishedPayload() == null ? entry.payload() : entry.publishedPayload();
        for (String refField : type.publicRequiresPublishedRefs()) {
            Object raw = payload == null ? null : payload.get(refField);
            if (raw == null) {
                continue;
            }
            try {
                EntryRecord target = content.findEntry(UUID.fromString(raw.toString())).orElse(null);
                if (target == null
                        || target.deleted()
                        || target.publicationState() != PublicationState.PUBLISHED
                        || !PublicVisibility.gettable(target.publishedPayload())) {
                    return false;
                }
            } catch (IllegalArgumentException e) {
                return false;
            }
        }
        return true;
    }

    public Optional<Map<String, Object>> resolvePublic(Object rawMediaRef) {
        UUID id = parseMediaId(rawMediaRef);
        if (id == null || !publiclyReadable(id)) {
            return Optional.empty();
        }
        return Optional.of(json(get(id), true));
    }

    public static UUID parseMediaId(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof Map<?, ?> map && map.get("mediaId") != null) {
            try {
                return UUID.fromString(String.valueOf(map.get("mediaId")));
            } catch (IllegalArgumentException e) {
                return null;
            }
        }
        try {
            return UUID.fromString(String.valueOf(raw));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private byte[] bytes(MediaAsset asset, String variant, boolean publicChannel) {
        if (variant == null || !(variant.equals("original") || variant.equals("thumbnail") || variant.equals("web"))) {
            throw publicChannel ? MediaException.notFound() : MediaException.variantNotAvailable();
        }
        MediaVariant found = asset.variants().stream()
                .filter(v -> v.variant().equals(variant))
                .findFirst()
                .orElse(null);
        if (found == null) {
            throw publicChannel ? MediaException.notFound() : MediaException.variantNotAvailable();
        }
        return objects.get(found.objectKey()).orElseThrow(publicChannel ? MediaException::notFound : MediaException::variantNotAvailable);
    }

    private boolean canReadPrivate(Principal principal, Surface surface, MediaAsset asset) {
        if (principal == null) {
            throw IdentityException.unauthenticated();
        }
        if (authorization.allow(principal, CmsAction.MANAGE_MEDIA, null, null, surface).allowed()) {
            return true;
        }
        for (MediaAttachment attachment : store.attachmentsOfMedia(asset.id())) {
            Optional<EntryRecord> entry = content.findEntry(attachment.entryId());
            if (entry.isEmpty()) {
                continue;
            }
            if (authorization.allow(principal, CmsAction.READ_DRAFT, entry.get().contentTypeKey(), entry.get().payload(), surface)
                    .allowed()) {
                return true;
            }
        }
        return false;
    }

    static String sniff(byte[] bytes) {
        if (bytes.length >= 3 && (bytes[0] & 0xFF) == 0xFF && (bytes[1] & 0xFF) == 0xD8 && (bytes[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (bytes.length >= 8
                && (bytes[0] & 0xFF) == 0x89
                && bytes[1] == 0x50
                && bytes[2] == 0x4E
                && bytes[3] == 0x47) {
            return "image/png";
        }
        if (bytes.length >= 6 && bytes[0] == 'G' && bytes[1] == 'I' && bytes[2] == 'F') {
            return "image/gif";
        }
        if (bytes.length >= 4 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F') {
            return "application/pdf";
        }
        return null;
    }

    private static String extension(String mime) {
        return switch (mime) {
            case "image/jpeg" -> ".jpg";
            case "image/png" -> ".png";
            case "image/gif" -> ".gif";
            case "application/pdf" -> ".pdf";
            default -> "";
        };
    }

    private static String stripExt(String filename) {
        if (filename == null || filename.isBlank()) {
            return "upload";
        }
        int dot = filename.lastIndexOf('.');
        return dot <= 0 ? filename : filename.substring(0, dot);
    }

    private static String sha256(byte[] bytes) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes);
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
