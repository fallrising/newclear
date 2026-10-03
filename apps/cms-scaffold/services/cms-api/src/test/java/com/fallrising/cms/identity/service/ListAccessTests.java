package com.fallrising.cms.identity.service;

import com.fallrising.cms.api.error.ErrorCode;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ListAccessTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");
    static final String OWN = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
    static final String NORTH = "{\"type\":\"fieldEquals\",\"field\":\"clinic\",\"value\":\"north\"}";
    static final List<String> ALL = List.of("front", "back", "admin");

    InMemoryIdentityStore store;
    AuthorizationService authorization;
    Role member;
    Principal anna;

    @BeforeEach
    void setUp() {
        store = new InMemoryIdentityStore();
        member = new Role(UUID.randomUUID(), "member", "Member", true, T0);
        store.insertRole(member);
        anna = new Principal(UUID.randomUUID(), "anna", "anna", null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
        store.insertPrincipal(anna);
        store.replacePrincipalRoles(anna.id(), List.of(new PrincipalRoleAssignment(anna.id(), member.id(), "member", List.of())));
        authorization = new AuthorizationService(store, new ObjectMapper());
    }

    void grant(String type, String predicate) {
        store.insertPermission(new Permission(UUID.randomUUID(), member.id(), "read_published", type, predicate, ALL, T0));
    }

    @Test
    void B10_predicateGrantsBecomeClausesWithCurrentPrincipalSubstituted() {
        grant("pet", OWN);
        grant("pet", NORTH);
        grant("pet", OWN);
        assertThat(authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "pet", Surface.FRONT))
                .isEqualTo(new AuthorizationService.ListAccess(false, List.of(
                        new AuthorizationService.ListAccess.Clause("ownerPrincipalId", anna.id().toString()),
                        new AuthorizationService.ListAccess.Clause("clinic", "north"))));
    }

    @Test
    void B10_anyGrantWithoutPredicateIsUnrestricted() {
        grant("pet", OWN);
        grant("pet", null);
        assertThat(authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "pet", Surface.BACK).unrestricted()).isTrue();
    }

    @Test
    void B10_anonymousGetsNoClauseForCurrentPrincipalPredicate() {
        Role anonymous = new Role(UUID.randomUUID(), "anonymous", "Anonymous", true, T0);
        store.insertRole(anonymous);
        store.insertPermission(new Permission(UUID.randomUUID(), anonymous.id(), "read_published", "pet", OWN, ALL, T0));
        store.insertPermission(new Permission(UUID.randomUUID(), anonymous.id(), "read_published", "pet", "{broken", ALL, T0));
        assertThat(authorization.listAccess(null, CmsAction.READ_PUBLISHED, "pet", Surface.FRONT))
                .isEqualTo(new AuthorizationService.ListAccess(false, List.of()));
    }

    @Test
    void B10_noMatchingGrantIsForbiddenAndHardDenyIsSurfaceForbidden() {
        grant("pet", OWN);
        assertThatThrownBy(() -> authorization.listAccess(anna, CmsAction.READ_PUBLISHED, "visit", Surface.FRONT))
                .isInstanceOf(IdentityException.class)
                .satisfies(e -> assertThat(((IdentityException) e).code()).isEqualTo(ErrorCode.FORBIDDEN));
        assertThatThrownBy(() -> authorization.listAccess(anna, CmsAction.READ_DRAFT, "pet", Surface.FRONT))
                .isInstanceOf(IdentityException.class)
                .satisfies(e -> assertThat(((IdentityException) e).code()).isEqualTo(ErrorCode.SURFACE_FORBIDDEN));
    }
}
