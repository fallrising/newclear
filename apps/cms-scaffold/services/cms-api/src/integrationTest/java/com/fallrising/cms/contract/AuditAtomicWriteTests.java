package com.fallrising.cms.contract;

import com.fallrising.cms.content.domain.NavigationRecord;
import com.fallrising.cms.content.service.NavigationService;
import com.fallrising.cms.content.store.JdbcContentStore;
import com.fallrising.cms.content.web.AdminContentController;
import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.CmsAction;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.service.AuthService;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import com.fallrising.cms.identity.service.PrincipalAdminService;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.identity.web.IdentityErrorWriter;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.media.domain.MediaAsset;
import com.fallrising.cms.media.domain.MediaVariant;
import com.fallrising.cms.media.service.MediaService;
import com.fallrising.cms.media.store.JdbcMediaStore;
import com.fallrising.cms.media.store.MediaObjectStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

/** Real PostgreSQL fault injection: non-entry state and audit share one transaction. */
class AuditAtomicWriteTests {
    private final ObjectMapper mapper = new ObjectMapper();
    private JdbcContentStore content;
    private JdbcIdentityStore identity;
    private JdbcMediaStore media;
    private TransactionRunner transactions;
    private AuditLog failingAudit;
    private AuthorizationService allow;
    private JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        var source = PostgresFixture.cleanDataSource();
        content = new JdbcContentStore(source, mapper);
        identity = new JdbcIdentityStore(source, new org.springframework.transaction.support.TransactionTemplate(
                new org.springframework.jdbc.datasource.DataSourceTransactionManager(source)));
        media = new JdbcMediaStore(source);
        jdbc = new JdbcTemplate(source);
        transactions = new TransactionRunner(source);
        allow = mock(AuthorizationService.class);
        IdentityStore writer = mock(IdentityStore.class);
        doAnswer(call -> {
            identity.insertAudit(call.getArgument(0));
            throw new IllegalStateException("injected audit failure");
        }).when(writer).insertAudit(any(AuditEvent.class));
        failingAudit = new AuditLog(writer, mapper);
    }

    @Test
    void navigationPublishRollsBackStateVersionAndWrittenAudit() {
        var original = new NavigationRecord(UUID.randomUUID(), "main", "front", "draft", 3,
                Map.of("items", List.of()), null, null, IdentityStoreContract.T0);
        content.upsertNavigation(original);
        var service = new NavigationService(content, allow, transactions, failingAudit);
        assertThatThrownBy(() -> service.publish(null, Surface.ADMIN, "main"))
                .hasMessage("injected audit failure");
        assertThat(content.findNavigation("main")).contains(original);
        assertNoAudits();
        new NavigationService(content, allow, transactions, new AuditLog(identity, mapper))
                .publish(null, Surface.ADMIN, "main");
        assertThat(content.findNavigation("main").orElseThrow().version()).isEqualTo(4);
        assertThat(identity.listAudits("navigation.publish", original.id())).hasSize(1);
    }

    @Test
    void mediaDeletionRollsBackDatabaseAndRetainsBlobsOnFailureAndSuccess() {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        var asset = new MediaAsset(id, UUID.randomUUID(), "test", "", "test.pdf", "application/pdf",
                1, 1, null, null, "a".repeat(64), "available", null, now, now, List.of());
        media.insert(asset);
        media.insertVariant(new MediaVariant(id, "original", "application/pdf", 1, null, null, "test/original"));
        var original = media.find(id).orElseThrow();
        MediaObjectStore blobs = mock(MediaObjectStore.class);
        var service = new MediaService(media, blobs, content, allow, transactions, failingAudit);
        assertThatThrownBy(() -> service.softDelete(null, Surface.ADMIN, id)).hasMessage("injected audit failure");
        assertThat(media.find(id)).contains(original);
        assertNoAudits();
        new MediaService(media, blobs, content, allow, transactions, new AuditLog(identity, mapper))
                .softDelete(null, Surface.ADMIN, id);
        assertThat(media.find(id).orElseThrow().status()).isEqualTo("deleted");
        assertThat(identity.listAudits("media.delete", id)).hasSize(1);
        verifyNoInteractions(blobs);
    }

    @Test
    void rolePermissionUpdateRollsBackGrantsAndWrittenAudit() {
        var adminRole = IdentityStoreContract.role("admin");
        identity.insertRole(adminRole);
        identity.insertPermission(IdentityStoreContract.permission(adminRole.id(), "manage_principals", null, null,
                List.of("admin")));
        var admin = IdentityStoreContract.principal("root");
        identity.insertPrincipal(admin);
        identity.replacePrincipalRoles(admin.id(), List.of(new com.fallrising.cms.identity.domain.PrincipalRoleAssignment(
                admin.id(), adminRole.id(), "admin", List.of())));
        assertThat(identity.countUsableAdmins()).isEqualTo(1);
        var role = IdentityStoreContract.role("editor");
        identity.insertRole(role);
        var original = IdentityStoreContract.permission(role.id(), "update", "album", null, List.of("back"));
        identity.insertPermission(original);
        var service = new PrincipalAdminService(identity, null, mock(AuthService.class), allow, mapper,
                mock(ContentTypeDirectory.class), transactions, failingAudit);
        var request = new IdentityRequest();
        request.setSurface(Surface.ADMIN);
        assertThatThrownBy(() -> service.replaceRolePermissions(request, "editor", List.of()))
                .hasMessage("injected audit failure");
        assertThat(identity.permissionsOfRole(role.id())).containsExactly(original);
        assertNoAudits();
        new PrincipalAdminService(identity, null, mock(AuthService.class), allow, mapper,
                mock(ContentTypeDirectory.class), transactions, new AuditLog(identity, mapper))
                .replaceRolePermissions(request, "editor", List.of());
        assertThat(identity.permissionsOfRole(role.id())).isEmpty();
        assertThat(identity.listAudits("role.permissions_update", role.id())).hasSize(1);
    }

    @Test
    void typeCreationAndEnableDisableRollBackAlongsideAudit() {
        var request = new MockHttpServletRequest();
        var identityRequest = new IdentityRequest();
        identityRequest.setSurface(Surface.ADMIN);
        request.setAttribute(IdentityErrorWriter.ATTR, identityRequest);
        var controller = new AdminContentController(content, null, null, allow, transactions, failingAudit);
        var body = new AdminContentController.TypeBody("rollback_type", null, null, null, null,
                List.of(new AdminContentController.FieldBody("title", "string", false, false, null, List.of())));
        assertThatThrownBy(() -> controller.createType(body, request)).hasMessage("injected audit failure");
        assertThat(content.findTypeByKey("rollback_type")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_field", Long.class)).isZero();
        assertNoAudits();
        var type = ContentStoreContract.type("rollback_type");
        content.insertType(type);
        assertThatThrownBy(() -> controller.disable(type.typeKey(), request)).hasMessage("injected audit failure");
        assertThat(content.findTypeByKey(type.typeKey())).contains(type);
        var disabled = type.withEnabled(false, IdentityStoreContract.T0.plusSeconds(1));
        content.updateType(disabled);
        assertThatThrownBy(() -> controller.enable(type.typeKey(), request)).hasMessage("injected audit failure");
        assertThat(content.findTypeByKey(type.typeKey())).contains(disabled);
        assertNoAudits();
    }

    @Test
    void deniedGovernanceAuditCommitsDespiteAmbientTransactionRollback() {
        var authorization = new AuthorizationService(identity, mapper, transactions);
        assertThatThrownBy(() -> transactions.run(() -> {
            var type = ContentStoreContract.type("rolled_back");
            content.insertType(type);
            authorization.require(null, CmsAction.MANAGE_TYPES, null, null, Surface.BACK);
        })).isInstanceOf(IdentityException.class);
        assertThat(content.findTypeByKey("rolled_back")).isEmpty();
        assertThat(identity.listAudits("manage_types", null)).singleElement().satisfies(event -> {
            assertThat(event.outcome()).isEqualTo("denied");
            assertThat(event.category()).isEqualTo("GOVERNANCE");
            assertThat(event.detailJson()).contains("SURFACE_FORBIDDEN");
        });
    }

    private void assertNoAudits() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class)).isZero();
    }
}
