package com.fallrising.cms.contract;

import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.InMemoryIdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;

class InMemoryIdentityMaintenanceContractTests extends IdentityMaintenanceContract {
    @org.junit.jupiter.api.Test
    void PP1FM04_primitiveMutableListsAndSessionBytesRollBack() {
        var admin = role("admin"); store.insertRole(admin);
        var principal = principal("mutable.fixture", false); store.insertPrincipal(principal);
        store.replacePrincipalRoles(principal.id(), java.util.List.of(new com.fallrising.cms.identity.domain.PrincipalRoleAssignment(
                principal.id(), admin.id(), "admin", new java.util.ArrayList<>(java.util.List.of("page")))));
        store.insertPermission(new com.fallrising.cms.identity.domain.Permission(java.util.UUID.randomUUID(), admin.id(), "read_published",
                null, null, new java.util.ArrayList<>(java.util.List.of("front")), T0));
        store.insertSession(new com.fallrising.cms.identity.domain.SessionRecord(java.util.UUID.randomUUID(), principal.id(), new byte[]{1, 2, 3},
                T0, T0.plusSeconds(100), T0, null, "admin", null, null));
        Object before = snapshot();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> store.maintenanceTransaction(() -> {
            store.rolesOf(principal.id()).getFirst().contentTypeCodes().add("album");
            store.permissionsOfRole(admin.id()).getFirst().allowedSurfaces().clear();
            store.findSessionByTokenHash(new byte[]{1, 2, 3}).orElseThrow().tokenHash()[0] = 7;
            throw new IllegalStateException("mutable rollback fault");
        })).isInstanceOf(IllegalStateException.class);
        org.assertj.core.api.Assertions.assertThat(snapshot()).isEqualTo(before);
        org.assertj.core.api.Assertions.assertThatCode(() -> store.insertPermission(new com.fallrising.cms.identity.domain.Permission(
                java.util.UUID.randomUUID(), admin.id(), "read_draft", null, null, java.util.List.of("back"), T0))).doesNotThrowAnyException();
    }
    @Override protected IdentityStore newStore() {
        transactions = TransactionRunner.withoutDatabase();
        return new InMemoryIdentityStore() {
            @Override public void upsertPasswordCredential(java.util.UUID id, String hash, String algo) {
                super.upsertPasswordCredential(id, hash, algo); afterWrite("credential");
            }
            @Override public void replacePrincipalRoles(java.util.UUID id, java.util.List<com.fallrising.cms.identity.domain.PrincipalRoleAssignment> roles) {
                super.replacePrincipalRoles(id, roles); afterWrite("assignment");
            }
            @Override public com.fallrising.cms.identity.domain.Principal updatePrincipal(com.fallrising.cms.identity.domain.Principal p) {
                var result = super.updatePrincipal(p); afterWrite("principal"); return result;
            }
            @Override public void revokeAllForPrincipal(java.util.UUID id, java.time.Instant at, java.util.UUID except) {
                super.revokeAllForPrincipal(id, at, except); afterWrite("revoke");
            }
            @Override public void insertAudit(com.fallrising.cms.identity.domain.AuditEvent event) {
                super.insertAudit(event); afterWrite("audit");
            }
        };
    }
    @Override protected void removePasswordFixture(java.util.UUID principalId) {
        try {
            var field = InMemoryIdentityStore.class.getDeclaredField("credentials"); field.setAccessible(true);
            ((java.util.Map<?, ?>) field.get(store)).remove(principalId);
        } catch (ReflectiveOperationException failure) { throw new AssertionError(failure); }
    }
    @Override protected Object snapshot() {
        var state = new LinkedHashMap<String, Object>();
        try {
            for (String name : new String[]{"principals", "usernameIndex", "credentials", "roles", "principalRoles",
                    "permissions", "sessionsByHash", "sessionsById", "audits"}) {
                var field = InMemoryIdentityStore.class.getDeclaredField(name);
                field.setAccessible(true); state.put(name, field.get(store));
            }
            return new ObjectMapper().findAndRegisterModules().valueToTree(state);
        } catch (Exception exception) { throw new AssertionError("snapshot unavailable", exception); }
    }
}
