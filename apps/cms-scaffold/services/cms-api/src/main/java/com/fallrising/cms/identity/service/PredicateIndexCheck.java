package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Fail fast (02 §4.1 step 3): after the identity seed (order 0) and the content type seed (order 100), every stored
 * permission that carries a predicate must name a content type and a field whose predicate can be pushed into list
 * queries. Otherwise startup fails, instead of list queries silently returning too much or too little.
 */
@Component
@Order(150)
public class PredicateIndexCheck {

    private final IdentityStore store;
    private final ContentTypeDirectory contentTypes;
    private final ObjectMapper objectMapper;

    public PredicateIndexCheck(IdentityStore store, ContentTypeDirectory contentTypes, ObjectMapper objectMapper) {
        this.store = store;
        this.contentTypes = contentTypes;
        this.objectMapper = objectMapper;
    }

    @Order(150)
    @EventListener(ApplicationReadyEvent.class)
    public void check() {
        List<String> problems = new ArrayList<>();
        for (Role role : store.listRoles()) {
            for (Permission permission : store.permissionsOfRole(role.id())) {
                String problem = problem(objectMapper, contentTypes, permission.contentTypeCode(), permission.predicateJson());
                if (problem != null) problems.add(role.code() + "/" + permission.action() + ": " + problem);
            }
        }
        if (!problems.isEmpty()) {
            throw new IllegalStateException("Predicates that cannot be pushed into list queries: " + problems);
        }
    }

    /** Null when the permission has no predicate or its predicate is compilable; otherwise the reason. */
    static String problem(ObjectMapper mapper, ContentTypeDirectory contentTypes, String contentTypeCode, String predicateJson) {
        if (predicateJson == null || predicateJson.isBlank()) return null;
        FieldEqualsPredicate predicate = FieldEqualsPredicate.parse(mapper, predicateJson);
        if (predicate == null) return "unsupported or malformed predicate";
        if (contentTypeCode == null || contentTypeCode.isBlank()) return "a predicate requires contentType";
        if (!contentTypes.predicateFieldCompilable(contentTypeCode, predicate.field())) {
            return "predicate field " + predicate.field() + " is not an indexed string, enum or ref field of " + contentTypeCode;
        }
        return null;
    }
}
