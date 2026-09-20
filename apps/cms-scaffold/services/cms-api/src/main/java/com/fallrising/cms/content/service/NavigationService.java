package com.fallrising.cms.content.service;

import com.fallrising.cms.content.ContentException;
import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.store.ContentStore;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthorizationService;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@Service
public class NavigationService {

    private final ContentStore store;
    private final AuthorizationService authorization;

    public NavigationService(ContentStore store, AuthorizationService authorization) {
        this.store = store;
        this.authorization = authorization;
    }

    public NavigationRecord getWork(Principal principal, Surface surface, String menuKey) {
        authorization.require(principal, CmsAction.MANAGE_SETTINGS, null, null, surface);
        return store.findNavigation(menuKey).orElseThrow(ContentException::navNotFound);
    }

    public NavigationRecord patch(Principal principal, Surface surface, String menuKey, Map<String, Object> document) {
        authorization.require(principal, CmsAction.MANAGE_SETTINGS, null, null, surface);
        NavigationRecord current = store.findNavigation(menuKey).orElseThrow(ContentException::navNotFound);
        Instant now = Instant.now();
        NavigationRecord next = new NavigationRecord(
                current.id(),
                current.menuKey(),
                current.surface(),
                current.publicationState(),
                current.version() + 1,
                document == null ? current.document() : new LinkedHashMap<>(document),
                current.publishedDocument(),
                principal == null ? current.updatedBy() : principal.id(),
                now);
        store.upsertNavigation(next);
        return next;
    }

    public NavigationRecord publish(Principal principal, Surface surface, String menuKey) {
        authorization.require(principal, CmsAction.MANAGE_SETTINGS, null, null, surface);
        NavigationRecord current = store.findNavigation(menuKey).orElseThrow(ContentException::navNotFound);
        Instant now = Instant.now();
        NavigationRecord next = new NavigationRecord(
                current.id(),
                current.menuKey(),
                current.surface(),
                "published",
                current.version() + 1,
                current.document(),
                current.document(),
                principal == null ? current.updatedBy() : principal.id(),
                now);
        store.upsertNavigation(next);
        return next;
    }

    public Map<String, Object> publicGet(String menuKey) {
        NavigationRecord menu = store.findNavigation(menuKey).orElseThrow(ContentException::navNotFound);
        if (!"published".equals(menu.publicationState()) || menu.publishedDocument() == null) {
            throw ContentException.navNotFound();
        }
        return menu.publishedDocument();
    }
}
