package com.fallrising.cms;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Permission;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.Role;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import org.postgresql.ds.PGSimpleDataSource;

import javax.sql.DataSource;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class JdbcIdentityStoreIntegrationTests {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

    JdbcIdentityStore store;

    @BeforeEach
    void setUp() {
        DataSource dataSource = dataSource();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").cleanDisabled(false).load().clean();
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        store = new JdbcIdentityStore(dataSource, new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
    }

    @Test
    void flywayStartsIdentitySchema() {
        assertThat(store.listRoles()).isEmpty();
    }

    @Test
    void touchCannotClearRevocation() {
        Principal principal = principal("session-user");
        store.insertPrincipal(principal);
        Instant now = Instant.now();
        SessionRecord session = new SessionRecord(UUID.randomUUID(), principal.id(), new byte[]{9,8,7}, now.minusSeconds(60),
                now.plusSeconds(3600), now.minusSeconds(10), null, "back", null, null);
        store.insertSession(session);

        store.revokeSession(session.id(), now);
        boolean touched = store.touchSession(session.id(), now.plusSeconds(1), now.plusSeconds(7200), now.plusSeconds(1));

        assertThat(touched).isFalse();
        assertThat(store.findSessionByTokenHash(session.tokenHash()).orElseThrow().revokedAt()).isNotNull();
    }

    @Test
    void principalRoleReplacementRollsBackOnDatabaseFailure() {
        Principal principal = principal("role-user");
        store.insertPrincipal(principal);
        Role member = role("member");
        store.insertRole(member);
        PrincipalRoleAssignment original = new PrincipalRoleAssignment(principal.id(), member.id(), member.code(), List.of());
        store.replacePrincipalRoles(principal.id(), List.of(original));

        PrincipalRoleAssignment bad = new PrincipalRoleAssignment(principal.id(), UUID.randomUUID(), "missing", List.of());
        assertThatThrownBy(() -> store.replacePrincipalRolesKeepingUsableAdmin(principal.id(), List.of(bad)))
                .isInstanceOf(Exception.class);

        assertThat(store.rolesOf(principal.id())).extracting(PrincipalRoleAssignment::roleCode).containsExactly("member");
    }

    @Test
    void permissionReplacementRollsBackOnDatabaseFailure() {
        Role admin = role("admin");
        store.insertRole(admin);
        Permission original = permission(admin.id(), CmsAction.MANAGE_PRINCIPALS.wire(), List.of("admin"));
        store.insertPermission(original);

        Permission bad = new Permission(UUID.randomUUID(), admin.id(), CmsAction.READ_AUDIT.wire(), null, "{bad-json",
                List.of("admin"), Instant.now());
        assertThatThrownBy(() -> store.replaceRolePermissionsKeepingUsableAdmin(admin.id(), List.of(bad)))
                .isInstanceOf(Exception.class);

        assertThat(store.permissionsOfRole(admin.id())).extracting(Permission::action)
                .containsExactly(CmsAction.MANAGE_PRINCIPALS.wire());
    }

    @Test
    void lastAdminGuardRejectsRemovingAdministrativeCapability() {
        Role admin = role("admin");
        store.insertRole(admin);
        store.insertPermission(permission(admin.id(), CmsAction.MANAGE_PRINCIPALS.wire(), List.of("admin")));
        Principal principal = principal("admin-user");
        store.insertPrincipal(principal);
        store.replacePrincipalRoles(principal.id(), List.of(new PrincipalRoleAssignment(principal.id(), admin.id(), admin.code(), List.of())));

        assertThat(store.countUsableAdmins()).isEqualTo(1);
        assertThatThrownBy(() -> store.replacePrincipalRolesKeepingUsableAdmin(principal.id(), List.of()))
                .isInstanceOf(IdentityException.class);
        assertThat(store.countUsableAdmins()).isEqualTo(1);
    }

    private static DataSource dataSource() {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setURL(postgres.getJdbcUrl());
        ds.setUser(postgres.getUsername());
        ds.setPassword(postgres.getPassword());
        return ds;
    }

    private static Principal principal(String username) {
        Instant now = Instant.now();
        return new Principal(UUID.randomUUID(), username, username, null, PrincipalStatus.ACTIVE, 0, null, null, now, now, null);
    }

    private static Role role(String code) {
        return new Role(UUID.randomUUID(), code, code, true, Instant.now());
    }

    private static Permission permission(UUID roleId, String action, List<String> surfaces) {
        return new Permission(UUID.randomUUID(), roleId, action, null, null, surfaces, Instant.now());
    }
}
