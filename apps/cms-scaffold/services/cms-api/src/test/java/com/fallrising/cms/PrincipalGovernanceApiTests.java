package com.fallrising.cms;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.*;
import com.fallrising.cms.identity.service.*;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.support.ApiFixture;
import com.fallrising.cms.support.TestSession;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PrincipalGovernanceApiTests {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired IdentityStore store;
    ApiFixture api;
    TestSession actor;
    UUID id;

    @BeforeEach void freshActor() throws Exception {
        api = new ApiFixture(mvc, mapper);
        var seed = TestSession.login(mvc, "seed-admin", IdentityAuthTests.PASSWORD, TestSession.ADMIN);
        actor = api.principalWithRole(seed, "admin", List.of(), TestSession.ADMIN);
        id = UUID.fromString(api.json(mvc.perform(actor.apply(get("/api/v1/auth/me")))
                .andExpect(status().isOk())).path("principal").get("id").asText());
    }

    @ParameterizedTest @ValueSource(strings = {"patch", "disable", "roles"})
    void PP1FM05_selfCannotDisableOrDemoteWithSecondAdmin(String operation) throws Exception {
        assertThat(store.countUsableAdmins()).isGreaterThanOrEqualTo(2);
        var before = store.findPrincipalById(id).orElseThrow();
        var roles = store.rolesOf(id);
        String action = operation.equals("roles") ? "ROLE_ASSIGNED" : "PRINCIPAL_DISABLED";
        int prior = store.listAudits(action, id).size();
        var request = switch (operation) {
            case "patch" -> patch("/api/v1/principals/{id}", id).content("{\"status\":\"disabled\"}");
            case "disable" -> post("/api/v1/principals/{id}/disable", id);
            default -> put("/api/v1/principals/{id}/roles", id).content("[]");
        };
        String reason = operation.equals("roles") ? "SELF_DEMOTION_FORBIDDEN" : "SELF_DISABLE_FORBIDDEN";
        mvc.perform(actor.apply(request).contentType(MediaType.APPLICATION_JSON))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.error.code").value(reason));
        assertThat(store.findPrincipalById(id).orElseThrow()).isEqualTo(before);
        assertThat(store.rolesOf(id)).isEqualTo(roles);
        assertThat(store.findSessionByTokenHash(SessionTokens.sha256(actor.token())).orElseThrow().revoked()).isFalse();
        var audits = store.listAudits(action, id);
        assertThat(audits).hasSize(prior + 1);
        var denial = audits.stream().filter(a -> a.outcome().equals("denied")).toList();
        assertThat(denial).hasSize(1);
        assertThat(denial.getFirst().category()).isEqualTo("AUTH");
        assertThat(mapper.readTree(denial.getFirst().detailJson())).isEqualTo(mapper.valueToTree(Map.of("reason", reason)));
        mvc.perform(actor.apply(get("/api/v1/auth/me"))).andExpect(status().isOk());
    }

    @Test void validationPrecedesSelfAndRetainingAdminRemainsAllowed() throws Exception {
        int audits = store.listAudits("ROLE_ASSIGNED", id).size();
        for (String body : List.of("[{\"code\":\"missing\"}]", "[{\"code\":\"admin\"},{\"code\":\"admin\"}]", "[{\"code\":\"operator\"}]")) {
            mvc.perform(actor.apply(put("/api/v1/principals/{id}/roles", id)).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
        }
        assertThat(store.listAudits("ROLE_ASSIGNED", id)).hasSize(audits);
        mvc.perform(actor.apply(put("/api/v1/principals/{id}/roles", id)).contentType(MediaType.APPLICATION_JSON)
                .content("[{\"code\":\"admin\"},{\"code\":\"member\"}]" )).andExpect(status().isNoContent());
        mvc.perform(actor.apply(patch("/api/v1/principals/{id}", id)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Updated self\"}")).andExpect(status().isOk());
        assertThat(store.rolesOf(id)).extracting(PrincipalRoleAssignment::roleCode).contains("admin", "member");
    }

    @Test void PP1FM05_nonSelfLastAdminGuardStillHolds() {
        var memory = new InMemoryIdentityStore();
        var now = Instant.now();
        var role = new Role(UUID.randomUUID(), "admin", "admin", true, now);
        memory.insertRole(role);
        var permission = new Permission(UUID.randomUUID(), role.id(), "manage_principals", null, null, List.of("admin"), now);
        memory.insertPermission(permission);
        var target = principal("target", PrincipalStatus.ACTIVE, now);
        var locked = principal("locked-actor", PrincipalStatus.LOCKED, now);
        for (var p : List.of(target, locked)) {
            memory.insertPrincipal(p);
            memory.replacePrincipalRoles(p.id(), List.of(new PrincipalRoleAssignment(p.id(), role.id(), "admin", List.of())));
        }
        var props = new IdentityProperties();
        var hasher = new PasswordHasher(props);
        var authorization = new AuthorizationService(memory, mapper);
        var auth = new AuthService(memory, hasher, props, authorization);
        var types = org.mockito.Mockito.mock(ContentTypeDirectory.class);
        var service = new PrincipalAdminService(memory, hasher, auth, authorization, mapper, types);
        var request = new IdentityRequest(); request.setPrincipal(locked); request.setSurface(Surface.ADMIN);
        for (Runnable attempt : List.<Runnable>of(() -> service.disable(request, target.id()),
                () -> service.replaceRoles(request, target.id(), List.of()),
                () -> service.replaceRolePermissions(request, "admin", List.of()))) {
            assertThatThrownBy(attempt::run).isInstanceOfSatisfying(IdentityException.class,
                    error -> assertThat(error.code().wire()).isEqualTo("LAST_ADMIN"));
        }
        assertThat(memory.findPrincipalById(target.id()).orElseThrow()).isEqualTo(target);
        assertThat(memory.rolesOf(target.id())).extracting(PrincipalRoleAssignment::roleCode).containsExactly("admin");
        assertThat(memory.permissionsOfRole(role.id())).containsExactly(permission);
        assertThat(memory.listAudits(null, null)).hasSize(3).allMatch(a -> a.outcome().equals("denied"));
    }

    @Test void PP1FM05_selfRoleCheckUsesSharedGuard() {
        var memory = new InMemoryIdentityStore();
        var now = Instant.now();
        var adminRole = new Role(UUID.randomUUID(), "admin", "admin", true, now);
        var managerRole = new Role(UUID.randomUUID(), "manager", "manager", false, now);
        for (var role : List.of(adminRole, managerRole)) {
            memory.insertRole(role);
            memory.insertPermission(new Permission(UUID.randomUUID(), role.id(), "manage_principals", null, null, List.of("admin"), now));
        }
        var self = principal("manager", PrincipalStatus.ACTIVE, now);
        var other = principal("other-admin", PrincipalStatus.ACTIVE, now);
        memory.insertPrincipal(self); memory.insertPrincipal(other);
        memory.replacePrincipalRoles(self.id(), List.of(new PrincipalRoleAssignment(self.id(), managerRole.id(), "manager", List.of())));
        memory.replacePrincipalRoles(other.id(), List.of(new PrincipalRoleAssignment(other.id(), adminRole.id(), "admin", List.of())));
        var controlled = new com.fallrising.cms.platform.TransactionRunner((javax.sql.DataSource) null) {
            @Override public void run(Runnable work) {
                // Deterministic interleaving: a different administrator grants admin before this attempt obtains the shared guard.
                memory.replacePrincipalRolesKeepingUsableAdmin(self.id(), List.of(new PrincipalRoleAssignment(self.id(), adminRole.id(), "admin", List.of())));
                super.run(work);
            }
        };
        var properties = new IdentityProperties(); var hasher = new PasswordHasher(properties);
        var authorization = new AuthorizationService(memory, mapper);
        var auth = new AuthService(memory, hasher, properties, authorization);
        var service = new PrincipalAdminService(memory, hasher, auth, authorization, mapper,
                org.mockito.Mockito.mock(ContentTypeDirectory.class), controlled, new AuditLog(memory, mapper));
        var request = new IdentityRequest(); request.setPrincipal(self); request.setSurface(Surface.ADMIN);
        assertThatThrownBy(() -> service.replaceRoles(request, self.id(), List.of())).isInstanceOfSatisfying(IdentityException.class,
                failure -> assertThat(failure.code().wire()).isEqualTo("SELF_DEMOTION_FORBIDDEN"));
        assertThat(memory.rolesOf(self.id())).extracting(PrincipalRoleAssignment::roleCode).containsExactly("admin");
        assertThat(memory.findPrincipalById(self.id())).contains(self);
        assertThat(memory.listAudits("ROLE_ASSIGNED", self.id())).singleElement().satisfies(event -> {
            assertThat(event.outcome()).isEqualTo("denied");
            assertThat(event.detailJson()).contains("SELF_DEMOTION_FORBIDDEN");
        });
    }

    private static Principal principal(String name, PrincipalStatus status, Instant now) {
        return new Principal(UUID.randomUUID(), name, name, null, status, 0,
                status == PrincipalStatus.LOCKED ? now.plusSeconds(300) : null, null, now, now, null);
    }
}
