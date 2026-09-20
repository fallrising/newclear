package com.fallrising.cms;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.RoleCode;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuthService;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.service.PrincipalAdminService;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class IdentityHardeningTests {

    @Test
    void disabledPrincipalNeverBecomesLockedOrActiveThroughLogin() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        IdentityProperties props = props();
        PasswordHasher hasher = new PasswordHasher(props);
        AuthorizationService authz = new AuthorizationService(store, new ObjectMapper());
        AuthService auth = new AuthService(store, hasher, props, authz);
        Principal principal = principal("disabled-user", PrincipalStatus.DISABLED);
        store.insertPrincipal(principal);
        store.upsertPasswordCredential(principal.id(), hasher.hash("CorrectPassword123"), hasher.algo());

        IdentityRequest request = new IdentityRequest();
        request.setSurface(Surface.FRONT);
        for (int i = 0; i < props.getLockoutThreshold() + 1; i++) {
            assertThatThrownBy(() -> auth.login("disabled-user", "wrong-password", request))
                    .isInstanceOf(IdentityException.class);
        }
        Principal afterFailures = store.findPrincipalById(principal.id()).orElseThrow();
        assertThat(afterFailures.status()).isEqualTo(PrincipalStatus.DISABLED);
        assertThat(afterFailures.failedLoginCount()).isZero();

        assertThatThrownBy(() -> auth.login("disabled-user", "CorrectPassword123", request))
                .isInstanceOf(IdentityException.class)
                .satisfies(e -> assertThat(((IdentityException) e).code().name()).isEqualTo("ACCOUNT_DISABLED"));
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.DISABLED);
    }

    @Test
    void touchCannotResurrectRevokedSessionAndHonorsMaximumLifetime() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        IdentityProperties props = props();
        PasswordHasher hasher = new PasswordHasher(props);
        AuthService auth = new AuthService(store, hasher, props, new AuthorizationService(store, new ObjectMapper()));
        Instant created = Instant.now().minus(Duration.ofDays(6)).minus(Duration.ofHours(23));
        SessionRecord session = new SessionRecord(UUID.randomUUID(), UUID.randomUUID(), new byte[]{1,2,3}, created,
                Instant.now().plus(Duration.ofHours(2)), created, null, "back", null, null);
        store.insertSession(session);
        Instant now = Instant.now();
        SessionRecord touched = auth.touch(session, now);
        assertThat(touched.expiresAt()).isBeforeOrEqualTo(created.plus(props.getSessionMax()));

        store.revokeSession(session.id(), now.plusSeconds(1));
        assertThatThrownBy(() -> auth.touch(session, now.plusSeconds(2)))
                .isInstanceOf(IdentityException.class);
        assertThat(store.findSessionByTokenHash(session.tokenHash()).orElseThrow().revoked()).isTrue();
    }

    @Test
    void predicateFailsClosedWithoutEntryOrRequiredField() {
        InMemoryIdentityStore store = memberStore();
        Principal member = store.findPrincipalByUsername("member").orElseThrow();
        AuthorizationService authz = new AuthorizationService(store, new ObjectMapper());

        assertThat(authz.allow(member, CmsAction.READ_PUBLISHED, "pet", null, Surface.FRONT).allowed()).isFalse();
        assertThat(authz.allow(member, CmsAction.READ_PUBLISHED, "pet", Map.of("other", "x"), Surface.FRONT).allowed()).isFalse();
        assertThat(authz.allow(member, CmsAction.READ_PUBLISHED, "pet", Map.of("ownerPrincipalId", member.id().toString()), Surface.FRONT).allowed()).isTrue();
        assertThat(authz.allow(member, CmsAction.READ_PUBLISHED, "pet", Map.of("ownerPrincipalId", UUID.randomUUID().toString()), Surface.FRONT).allowed()).isFalse();
    }

    @Test
    void malformedPredicateFailsClosed() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        Role role = role("member");
        store.insertRole(role);
        Principal member = principal("member", PrincipalStatus.ACTIVE);
        store.insertPrincipal(member);
        store.replacePrincipalRoles(member.id(), List.of(new PrincipalRoleAssignment(member.id(), role.id(), role.code(), List.of())));
        store.insertPermission(new Permission(UUID.randomUUID(), role.id(), CmsAction.READ_PUBLISHED.wire(), "pet", "{bad-json", List.of("front"), Instant.now()));
        AuthorizationService authz = new AuthorizationService(store, new ObjectMapper());
        assertThat(authz.allow(member, CmsAction.READ_PUBLISHED, "pet", Map.of("ownerPrincipalId", member.id().toString()), Surface.FRONT).allowed()).isFalse();
    }

    @Test
    void lastAdminGuardAppliesToPatchRolesAndPermissions() {
        InMemoryIdentityStore store = adminStore();
        IdentityProperties props = props();
        PasswordHasher hasher = new PasswordHasher(props);
        ObjectMapper mapper = new ObjectMapper();
        AuthorizationService authz = new AuthorizationService(store, mapper);
        AuthService auth = new AuthService(store, hasher, props, authz);
        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper);
        Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
        IdentityRequest request = adminRequest(principal);

        assertThatThrownBy(() -> admin.patch(request, principal.id(), null, null, "disabled"))
                .isInstanceOf(IdentityException.class);
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.ACTIVE);

        assertThatThrownBy(() -> admin.replaceRoles(request, principal.id(), List.of()))
                .isInstanceOf(IdentityException.class);
        assertThat(store.rolesOf(principal.id())).extracting(PrincipalRoleAssignment::roleCode).contains("admin");

        assertThatThrownBy(() -> admin.replaceRolePermissions(request, "admin", List.of(
                new Permission(UUID.randomUUID(), UUID.randomUUID(), CmsAction.READ_AUDIT.wire(), null, null, List.of("admin"), Instant.now()))))
                .isInstanceOf(IdentityException.class);
        Role adminRole = store.findRoleByCode("admin").orElseThrow();
        assertThat(store.permissionsOfRole(adminRole.id())).extracting(Permission::action).contains(CmsAction.MANAGE_PRINCIPALS.wire());
    }

    @Test
    void replacementValidationHappensBeforeMutation() {
        InMemoryIdentityStore store = adminStore();
        IdentityProperties props = props();
        PasswordHasher hasher = new PasswordHasher(props);
        ObjectMapper mapper = new ObjectMapper();
        AuthorizationService authz = new AuthorizationService(store, mapper);
        AuthService auth = new AuthService(store, hasher, props, authz);
        PrincipalAdminService admin = new PrincipalAdminService(store, hasher, auth, authz, mapper);
        Principal principal = store.findPrincipalByUsername("admin").orElseThrow();
        IdentityRequest request = adminRequest(principal);
        Role adminRole = store.findRoleByCode("admin").orElseThrow();
        List<Permission> before = store.permissionsOfRole(adminRole.id());

        assertThatThrownBy(() -> admin.replaceRolePermissions(request, "admin", List.of(
                new Permission(UUID.randomUUID(), UUID.randomUUID(), "unknown_action", null, null, List.of("admin"), Instant.now()))))
                .isInstanceOf(IdentityException.class);
        assertThat(store.permissionsOfRole(adminRole.id())).containsExactlyElementsOf(before);
    }

    private static IdentityProperties props() {
        IdentityProperties props = new IdentityProperties();
        props.setArgon2MemoryKb(8);
        props.setArgon2Iterations(1);
        return props;
    }

    private static InMemoryIdentityStore memberStore() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        Role anonymous = role("anonymous");
        Role memberRole = role("member");
        store.insertRole(anonymous);
        store.insertRole(memberRole);
        Principal member = principal("member", PrincipalStatus.ACTIVE);
        store.insertPrincipal(member);
        store.replacePrincipalRoles(member.id(), List.of(new PrincipalRoleAssignment(member.id(), memberRole.id(), memberRole.code(), List.of())));
        store.insertPermission(new Permission(UUID.randomUUID(), memberRole.id(), CmsAction.READ_PUBLISHED.wire(), "pet",
                "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}", List.of("front"), Instant.now()));
        return store;
    }

    private static InMemoryIdentityStore adminStore() {
        InMemoryIdentityStore store = new InMemoryIdentityStore();
        Role anonymous = role("anonymous");
        Role adminRole = role("admin");
        store.insertRole(anonymous);
        store.insertRole(adminRole);
        Principal principal = principal("admin", PrincipalStatus.ACTIVE);
        store.insertPrincipal(principal);
        store.replacePrincipalRoles(principal.id(), List.of(new PrincipalRoleAssignment(principal.id(), adminRole.id(), adminRole.code(), List.of())));
        store.insertPermission(new Permission(UUID.randomUUID(), adminRole.id(), CmsAction.MANAGE_PRINCIPALS.wire(), null, null, List.of("admin"), Instant.now()));
        return store;
    }

    private static Role role(String code) {
        return new Role(UUID.randomUUID(), code, code, true, Instant.now());
    }

    private static Principal principal(String username, PrincipalStatus status) {
        Instant now = Instant.now();
        return new Principal(UUID.randomUUID(), username, username, null, status, 0, null, null, now, now, null);
    }

    private static IdentityRequest adminRequest(Principal principal) {
        IdentityRequest request = new IdentityRequest();
        request.setPrincipal(principal);
        request.setSurface(Surface.ADMIN);
        return request;
    }
}
