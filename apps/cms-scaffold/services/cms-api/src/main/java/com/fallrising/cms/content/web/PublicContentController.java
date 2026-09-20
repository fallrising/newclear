package com.fallrising.cms.content.web;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.ContentTypeRecord;
import com.fallrising.cms.content.domain.EntryRecord;
import com.fallrising.cms.content.service.EntryService;
import com.fallrising.cms.content.service.NavigationService;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.media.service.MediaService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/public")
public class PublicContentController {

    private final EntryService entries;
    private final ContentStore store;
    private final NavigationService navigation;
    private final MediaService media;
    private final AuthorizationService authorization;

    public PublicContentController(
            EntryService entries,
            ContentStore store,
            NavigationService navigation,
            MediaService media,
            AuthorizationService authorization) {
        this.entries = entries;
        this.store = store;
        this.navigation = navigation;
        this.media = media;
        this.authorization = authorization;
    }

    @GetMapping("/content-types")
    public Map<String, Object> types(HttpServletRequest request) {
        Principal principal = principal(request);
        List<Map<String, Object>> items = store.listTypes().stream()
                .filter(ContentTypeRecord::enabled)
                .filter(type -> authorization.hasAction(principal, CmsAction.READ_PUBLISHED, type.typeKey(), Surface.FRONT))
                .map(this::publicType)
                .toList();
        return Map.of("items", items);
    }

    @GetMapping("/content-types/{typeKey}/entries")
    public Map<String, Object> list(
            @PathVariable String typeKey,
            @RequestParam(required = false) String q,
            HttpServletRequest request) {
        rejectAudienceParams(request);
        String refField = null;
        UUID refTarget = null;
        for (String name : request.getParameterMap().keySet()) {
            if (name.startsWith("ref.") && request.getParameter(name) != null && !request.getParameter(name).isBlank()) {
                refField = name.substring(4);
                refTarget = UUID.fromString(request.getParameter(name));
            }
        }
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
        List<EntryRecord> found = entries.publicList(principal(request), typeKey, q, refField, refTarget);
        List<Map<String, Object>> items = found.stream()
                .map(e -> ContentProjection.published(e, type, store.fieldsOf(type.id()), this::expandMedia))
                .toList();
        return page(items);
    }

    @GetMapping("/content-types/{typeKey}/entries/{id}")
    public Map<String, Object> byId(@PathVariable String typeKey, @PathVariable UUID id, HttpServletRequest request) {
        rejectAudienceParams(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
        EntryRecord entry = entries.publicGet(principal(request), typeKey, id, null);
        return ContentProjection.published(entry, type, store.fieldsOf(type.id()), this::expandMedia);
    }

    @GetMapping("/content-types/{typeKey}/slugs/{slug}")
    public Map<String, Object> bySlug(@PathVariable String typeKey, @PathVariable String slug, HttpServletRequest request) {
        rejectAudienceParams(request);
        ContentTypeRecord type = store.findTypeByKey(typeKey).orElseThrow(ContentException::notFound);
        EntryRecord entry = entries.publicGet(principal(request), typeKey, null, slug);
        return ContentProjection.published(entry, type, store.fieldsOf(type.id()), this::expandMedia);
    }

    @GetMapping("/navigation/{menuKey}")
    public Map<String, Object> navigation(@PathVariable String menuKey) {
        return navigation.publicGet(menuKey);
    }

    private Map<String, Object> publicType(ContentTypeRecord type) {
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("key", type.typeKey());
        json.put("displayName", type.displayName());
        json.put("pluralDisplayName", type.pluralDisplayName());
        json.put("titleField", type.titleField());
        json.put("fields", store.fieldsOf(type.id()).stream()
                .filter(f -> f.enabled() && "public".equals(f.visibility()))
                .map(f -> Map.of("key", f.fieldKey(), "type", f.fieldType(), "required", f.required()))
                .toList());
        return json;
    }

    private Object expandMedia(Object raw) {
        return media.resolvePublic(raw).map(Object.class::cast).orElse(raw);
    }

    private static Map<String, Object> page(List<Map<String, Object>> items) {
        return Map.of("items", items, "total", items.size(), "offset", 0, "limit", items.size());
    }

    private static void rejectAudienceParams(HttpServletRequest request) {
        if (request.getParameter("state") != null
                || request.getParameter("includeDraft") != null
                || request.getParameter("asOf") != null) {
            throw ContentException.audienceParam();
        }
    }

    private static Principal principal(HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        return identity == null ? null : identity.principal();
    }
}
