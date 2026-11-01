package com.fallrising.cms.identity.service;

import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Proxy;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

class GrantCacheTests {

    static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    AtomicInteger rolesOfCalls = new AtomicInteger();
    AuthorizationService authorization;
    AuthService auth;
    Principal principal;
    InMemoryIdentityStore real;
    Role operator;

    @BeforeEach
    void setUp() {
        real = new InMemoryIdentityStore();
        operator = new Role(UUID.randomUUID(), "operator", "Operator", true, T0);
        real.insertRole(operator);
        real.insertPermission(new Permission(UUID.randomUUID(), operator.id(), "read_draft", null, null, List.of("back"), T0));
        principal = new Principal(UUID.randomUUID(), "anna", "anna", null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
        real.insertPrincipal(principal);
        real.replacePrincipalRoles(principal.id(),
                List.of(new PrincipalRoleAssignment(principal.id(), operator.id(), "operator", List.of("album"))));
        IdentityStore counting = (IdentityStore) Proxy.newProxyInstance(
                IdentityStore.class.getClassLoader(), new Class<?>[] {IdentityStore.class}, (proxy, method, args) -> {
                    if (method.getName().equals("rolesOf")) rolesOfCalls.incrementAndGet();
                    return method.invoke(real, args);
                });
        authorization = new AuthorizationService(counting, new ObjectMapper());
        auth = new AuthService(counting, null, null, authorization);
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void B12_grantsAreLoadedOncePerRequest() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        for (int i = 0; i < 50; i++) {
            assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK)).isTrue();
        }
        authorization.capabilities(principal, Surface.BACK, List.of("album", "photo"));
        assertThat(rolesOfCalls.get()).isEqualTo(1);
    }

    @Test
    void B12_eachRequestLoadsItsOwnGrants() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

    @Test
    void B12_outsideARequestNothingIsCached() {
        for (int i = 0; i < 3; i++) {
            authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK);
        }
        assertThat(rolesOfCalls.get()).isEqualTo(3);
    }
    @Test
    void B12_principalIdsHaveSeparateGrantsWithinOneRequest() {
        Principal other = new Principal(UUID.randomUUID(), "bob", "bob", null, PrincipalStatus.ACTIVE,
                0, null, null, T0, T0, null);
        real.insertPrincipal(other);
        real.replacePrincipalRoles(other.id(),
                List.of(new PrincipalRoleAssignment(other.id(), operator.id(), "operator", List.of("photo"))));
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK)).isTrue();
        assertThat(authorization.hasAction(other, CmsAction.READ_DRAFT, "album", Surface.BACK)).isFalse();
        assertThat(authorization.hasAction(other, CmsAction.READ_DRAFT, "photo", Surface.BACK)).isTrue();
        assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "photo", Surface.BACK)).isFalse();
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

    @Test
    void B12_nextRequestSeesChangedPermissions() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK)).isTrue();
        real.replaceRolePermissions(operator.id(), List.of());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThat(authorization.hasAction(principal, CmsAction.READ_DRAFT, "album", Surface.BACK)).isFalse();
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

    @Test
    void G01_unscopedGrantOverridesPredicateForThatActionOnly() {
        String predicate = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        real.replaceRolePermissions(operator.id(), List.of(
                new Permission(UUID.randomUUID(), operator.id(), "read_draft", null, predicate, List.of("back"), T0),
                new Permission(UUID.randomUUID(), operator.id(), "read_draft", null, null, List.of("back"), T0)));
        assertThat(authorization.capabilities(principal, Surface.BACK, List.of("album")).types().getFirst().scoped()).isFalse();
        real.insertPermission(new Permission(UUID.randomUUID(), operator.id(), "update", null, predicate, List.of("back"), T0));
        var capability = authorization.capabilities(principal, Surface.BACK, List.of("album")).types().getFirst();
        assertThat(capability.actions()).containsExactly("read_draft", "update");
        assertThat(capability.scoped()).isTrue();
        // Capabilities are hints; entry predicates remain enforced by the actual authorization decision.
        assertThat(authorization.allow(principal, CmsAction.UPDATE, "album", java.util.Map.of(), Surface.BACK).allowed()).isFalse();
    }

    @Test
    void B12_meAndCapabilitiesLoadRolesOnceInEitherOrder() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThat(auth.toMe(principal).surfaces()).containsEntry("back", true);
        assertThat(authorization.capabilities(principal, Surface.BACK, List.of("album")).types()).hasSize(1);
        assertThat(rolesOfCalls.get()).isEqualTo(1);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        authorization.capabilities(principal, Surface.BACK, List.of("album"));
        assertThat(auth.toMe(principal).roles()).hasSize(1);
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

    @Test
    void B12_meAndCapabilitiesSeeChangedRolesOnNextRequest() {
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        auth.toMe(principal);
        authorization.capabilities(principal, Surface.BACK, List.of("album"));
        real.replacePrincipalRoles(principal.id(), List.of());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(new MockHttpServletRequest()));
        assertThat(auth.toMe(principal).roles()).isEmpty();
        assertThat(auth.toMe(principal).surfaces()).containsEntry("back", false);
        assertThat(authorization.capabilities(principal, Surface.BACK, List.of("album")).types()).isEmpty();
        assertThat(rolesOfCalls.get()).isEqualTo(2);
    }

}
