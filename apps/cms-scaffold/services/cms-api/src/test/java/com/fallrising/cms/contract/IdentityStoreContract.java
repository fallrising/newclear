package com.fallrising.cms.contract;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Behaviour every IdentityStore must have (BD-10). */
public abstract class IdentityStoreContract {

    protected static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    protected IdentityStore store;

    protected abstract IdentityStore newStore();

    @BeforeEach
    void setUpStore() {
        store = newStore();
    }

    @Test
    void B08_principalRoundTripAndCaseInsensitiveUsername() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        assertThat(store.findPrincipalById(anna.id())).contains(anna);
        assertThat(store.findPrincipalByUsername("ANNA")).contains(anna);
        assertThat(store.findPrincipalByUsername("nobody")).isEmpty();
    }

    @Test
    void B08_deletedPrincipalIsHidden() {
        Principal gone = principal("gone");
        store.insertPrincipal(gone);
        store.updatePrincipal(new Principal(gone.id(), "gone", "gone", null, PrincipalStatus.ACTIVE, 0, null, null,
                T0, T0.plusSeconds(1), T0.plusSeconds(1)));
        assertThat(store.findPrincipalById(gone.id())).isEmpty();
        assertThat(store.findPrincipalByUsername("gone")).isEmpty();
        assertThat(store.listPrincipals()).isEmpty();
    }

    @Test
    void B08_listPrincipalsOrderedByUsername() {
        store.insertPrincipal(principal("carl"));
        store.insertPrincipal(principal("anna"));
        store.insertPrincipal(principal("bert"));
        assertThat(store.listPrincipals()).extracting(Principal::username).containsExactly("anna", "bert", "carl");
    }

    @Test
    void B08_duplicateUsernameIsRejected() {
        store.insertPrincipal(principal("anna"));
        assertThatThrownBy(() -> store.insertPrincipal(principal("anna"))).isInstanceOf(RuntimeException.class);
    }

    @Test
    void B08_updatePrincipalPersistsMutableColumns() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        Principal changed = new Principal(anna.id(), "anna", "Anna B", "anna@example.test", PrincipalStatus.LOCKED, 3,
                T0.plusSeconds(60), T0.plusSeconds(5), T0, T0.plusSeconds(6), null);
        store.updatePrincipal(changed);
        assertThat(store.findPrincipalById(anna.id())).contains(changed);
    }

    @Test
    void B08_passwordCredentialUpsert() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        assertThat(store.findPasswordCredential(anna.id())).isEmpty();
        store.upsertPasswordCredential(anna.id(), "hash-1", "argon2id");
        UUID firstId = store.findPasswordCredential(anna.id()).orElseThrow().id();
        store.upsertPasswordCredential(anna.id(), "hash-2", "argon2id");
        var credential = store.findPasswordCredential(anna.id()).orElseThrow();
        assertThat(credential.id()).isEqualTo(firstId);
        assertThat(credential.principalId()).isEqualTo(anna.id());
        assertThat(credential.type()).isEqualTo("password");
        assertThat(credential.secretHash()).isEqualTo("hash-2");
        assertThat(credential.algo()).isEqualTo("argon2id");
    }

    @Test
    void B08_rolesOrderedByCode() {
        store.insertRole(role("member"));
        store.insertRole(role("admin"));
        store.insertRole(role("editor"));
        assertThat(store.listRoles()).extracting(Role::code).containsExactly("admin", "editor", "member");
        assertThat(store.findRoleByCode("admin")).isPresent();
        assertThat(store.findRoleByCode("missing")).isEmpty();
    }

    @Test
    void B08_roleAssignmentsRoundTrip() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        Role editor = role("editor");
        store.insertRole(editor);
        PrincipalRoleAssignment assignment = new PrincipalRoleAssignment(anna.id(), editor.id(), "editor", List.of("album", "photo"));
        store.replacePrincipalRoles(anna.id(), List.of(assignment));
        assertThat(store.rolesOf(anna.id())).containsExactly(assignment);
        store.replacePrincipalRoles(anna.id(), List.of());
        assertThat(store.rolesOf(anna.id())).isEmpty();
    }

    @Test
    void B08_permissionsOrderedByActionAndPredicatePreserved() throws Exception {
        Role editor = role("editor");
        store.insertRole(editor);
        String predicate = "{\"type\":\"fieldEquals\",\"field\":\"ownerPrincipalId\",\"value\":\"$currentPrincipalId\"}";
        store.replaceRolePermissions(editor.id(), List.of(
                permission(editor.id(), "read_draft", "pet", predicate, List.of("back")),
                permission(editor.id(), "create", "pet", null, List.of("back", "admin")),
                permission(editor.id(), "publish", null, null, List.of("admin"))));
        List<Permission> found = store.permissionsOfRole(editor.id());
        assertThat(found).extracting(Permission::action).containsExactly("create", "publish", "read_draft");
        assertThat(found.get(0).allowedSurfaces()).containsExactly("back", "admin");
        assertThat(found.get(1).contentTypeCode()).isNull();
        ObjectMapper json = new ObjectMapper();
        assertThat(json.readTree(found.get(2).predicateJson())).isEqualTo(json.readTree(predicate));
    }

    @Test
    void B08_sessionTouchAndRevoke() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        SessionRecord session = session(anna.id(), new byte[] {1, 2, 3}, T0.plusSeconds(3600));
        store.insertSession(session);
        assertThat(store.findSessionByTokenHash(new byte[] {1, 2, 3})).isPresent();
        assertThat(store.findSessionByTokenHash(new byte[] {9})).isEmpty();

        assertThat(store.touchSession(session.id(), T0.plusSeconds(10), T0.plusSeconds(7200), T0.plusSeconds(10))).isTrue();
        SessionRecord touched = store.findSessionByTokenHash(new byte[] {1, 2, 3}).orElseThrow();
        assertThat(touched.lastSeenAt()).isEqualTo(T0.plusSeconds(10));
        assertThat(touched.expiresAt()).isEqualTo(T0.plusSeconds(7200));

        assertThat(store.touchSession(session.id(), T0.plusSeconds(8000), T0.plusSeconds(9000), T0.plusSeconds(8000))).isFalse();

        store.revokeSession(session.id(), T0.plusSeconds(20));
        assertThat(store.findSessionByTokenHash(new byte[] {1, 2, 3}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(20));
        assertThat(store.touchSession(session.id(), T0.plusSeconds(21), T0.plusSeconds(7200), T0.plusSeconds(21))).isFalse();
    }

    @Test
    void B08_revokeAllForPrincipalKeepsException() {
        Principal anna = principal("anna");
        store.insertPrincipal(anna);
        SessionRecord keep = session(anna.id(), new byte[] {1}, T0.plusSeconds(3600));
        SessionRecord drop = session(anna.id(), new byte[] {2}, T0.plusSeconds(3600));
        store.insertSession(keep);
        store.insertSession(drop);
        store.revokeAllForPrincipal(anna.id(), T0.plusSeconds(5), keep.id());
        assertThat(store.findSessionByTokenHash(new byte[] {1}).orElseThrow().revokedAt()).isNull();
        assertThat(store.findSessionByTokenHash(new byte[] {2}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(5));
        store.revokeAllForPrincipal(anna.id(), T0.plusSeconds(6), null);
        assertThat(store.findSessionByTokenHash(new byte[] {1}).orElseThrow().revokedAt()).isEqualTo(T0.plusSeconds(6));
    }

    @Test
    void B08_auditNewestFirstAndFilters() {
        UUID target = UUID.randomUUID();
        AuditEvent first = audit("LOGIN_SUCCESS", target, T0.plusSeconds(1));
        AuditEvent second = audit("LOGOUT", target, T0.plusSeconds(2));
        AuditEvent third = audit("LOGIN_SUCCESS", UUID.randomUUID(), T0.plusSeconds(3));
        store.insertAudit(first);
        store.insertAudit(second);
        store.insertAudit(third);
        assertThat(store.listAudits(null, null)).extracting(AuditEvent::id).containsExactly(third.id(), second.id(), first.id());
        assertThat(store.listAudits("", null)).hasSize(3);
        assertThat(store.listAudits("LOGIN_SUCCESS", null)).extracting(AuditEvent::id).containsExactly(third.id(), first.id());
        assertThat(store.listAudits(null, target)).extracting(AuditEvent::id).containsExactly(second.id(), first.id());
        assertThat(store.listAudits("LOGOUT", target)).containsExactly(second);
    }

    @Test
    void B08_lastAdminGuard() {
        Role admin = role("admin");
        store.insertRole(admin);
        store.insertPermission(permission(admin.id(), "manage_principals", null, null, List.of("admin")));
        Principal root = principal("root");
        store.insertPrincipal(root);
        store.replacePrincipalRoles(root.id(), List.of(new PrincipalRoleAssignment(root.id(), admin.id(), "admin", List.of())));
        assertThat(store.countUsableAdmins()).isEqualTo(1);

        assertThatThrownBy(() -> store.replacePrincipalRolesKeepingUsableAdmin(root.id(), List.of()))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> store.updatePrincipalKeepingUsableAdmin(
                new Principal(root.id(), "root", "root", null, PrincipalStatus.DISABLED, 0, null, null, T0, T0, null)))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> store.replaceRolePermissionsKeepingUsableAdmin(admin.id(), List.of()))
                .isInstanceOf(IdentityException.class);

        assertThat(store.countUsableAdmins()).isEqualTo(1);
        assertThat(store.rolesOf(root.id())).hasSize(1);
        assertThat(store.findPrincipalById(root.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.ACTIVE);
        assertThat(store.permissionsOfRole(admin.id())).hasSize(1);
    }

    protected static Principal principal(String username) {
        return new Principal(UUID.randomUUID(), username, username, null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, null);
    }

    protected static Role role(String code) {
        return new Role(UUID.randomUUID(), code, code, true, T0);
    }

    protected static Permission permission(UUID roleId, String action, String contentType, String predicate, List<String> surfaces) {
        return new Permission(UUID.randomUUID(), roleId, action, contentType, predicate, surfaces, T0);
    }

    protected static SessionRecord session(UUID principalId, byte[] hash, Instant expiresAt) {
        return new SessionRecord(UUID.randomUUID(), principalId, hash, T0, expiresAt, T0, null, "back", null, null);
    }

    protected static AuditEvent audit(String action, UUID target, Instant at) {
        return new AuditEvent(UUID.randomUUID(), at, null, "AUTH", action, "principal", target, "admin", "ok", null, null);
    }
}
