package com.fallrising.cms.content.web;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.service.MeService;
import com.fallrising.cms.identity.web.AuthController;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.media.service.MediaService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Member endpoints (02 §4.5). Front surface only; see MeService. */
@RestController
@RequestMapping("/api/v1/me")
public class MeController {

    private final MeService me;
    private final MediaService media;

    public MeController(MeService me, MediaService media) {
        this.me = me;
        this.media = media;
    }

    @GetMapping("/content-types/{typeKey}/entries")
    public Map<String, Object> list(@PathVariable String typeKey, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        MeService.MeList result = me.list(identity.principal(), identity.surface(), typeKey, request.getParameterMap());
        List<Map<String, Object>> items = result.page().items().stream()
                .map(e -> ContentProjection.member(e, result.type(), result.fields(), this::expandMedia))
                .toList();
        Map<String, Object> json = new LinkedHashMap<>();
        json.put("items", items);
        json.put("total", result.page().total());
        json.put("page", result.pageNo());
        json.put("size", result.size());
        json.put("offset", (result.pageNo() - 1L) * result.size());
        json.put("limit", result.size());
        return json;
    }

    @GetMapping("/entries/{id}")
    public Map<String, Object> get(@PathVariable UUID id, HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        MeService.MeEntry found = me.get(identity.principal(), identity.surface(), id);
        return ContentProjection.member(found.entry(), found.type(), found.fields(), this::expandMedia);
    }

    @PostMapping("/content-types/{typeKey}/entries")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@PathVariable String typeKey, @RequestBody Map<String, Object> body,
            HttpServletRequest request) {
        IdentityRequest identity = AuthController.current(request);
        MeService.MeEntry created = me.create(identity.principal(), identity.surface(), typeKey, payload(body), body.containsKey("publicationState"));
        return ContentProjection.member(created.entry(), created.type(), created.fields(), this::expandMedia);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> payload(Map<String, Object> body) {
        Object payload = body.get("payload");
        if (!(payload instanceof Map<?, ?>)) throw ContentException.invalidParameter("payload must be an object");
        return (Map<String, Object>) payload;
    }

    private Object expandMedia(Object raw) {
        return media.resolvePublic(raw).map(Object.class::cast).orElse(null);
    }
}
