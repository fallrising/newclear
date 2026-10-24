package com.fallrising.cms.contract;

import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.domain.*;
import com.fallrising.cms.identity.service.AuthService;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.identity.maintenance.ProductionIdentityService;
import com.fallrising.cms.identity.maintenance.MaintenanceGuard;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.*;

class ProductionIdentityIntegrationTests {
    @Test
    void PP1AC02_recoveredIdentitySurvivesNewStoreWithOldPasswordAndSessionsInvalid() {
        var source = PostgresFixture.cleanDataSource();
        var store = new JdbcIdentityStore(source, new TransactionTemplate(new DataSourceTransactionManager(source)));
        var transactions = new TransactionRunner(source); var properties = new IdentityProperties(); properties.setSeedEnabled(false);
        var hasher = new PasswordHasher(properties); var guard = mock(MaintenanceGuard.class); var lease = mock(MaintenanceGuard.Lease.class);
        when(guard.acquire(anyString(), any(UUID.class), any(Operation.class))).thenReturn(lease);
        when(lease.targetId()).thenReturn("fixture"); when(lease.releaseId()).thenReturn("sha256:fixture");
        when(lease.backupId()).thenReturn("verified-core-fixture");
        var service = new ProductionIdentityService(store, hasher, transactions, new AuditLog(store, new ObjectMapper()), guard);
        char[] old = UUID.randomUUID().toString().toCharArray(), next = UUID.randomUUID().toString().toCharArray();
        try {
            var initialized = service.freshInit(new Options(Operation.FRESH_INIT, "pp1.root", "Formal root", null, "fixture", UUID.randomUUID(), false), old);
            var authorization = new AuthorizationService(store, new ObjectMapper(), transactions);
            var auth = new AuthService(store, hasher, properties, authorization, transactions);
            var request = new IdentityRequest(); request.setSurface(Surface.ADMIN);
            var login = auth.login("pp1.root", new String(old), request);
            var oldTokenHash = com.fallrising.cms.identity.crypto.SessionTokens.sha256(login.sessionToken());
            var before = store.findPrincipalById(initialized.principalId()).orElseThrow();
            var oldHash = store.findPasswordCredential(before.id()).orElseThrow().secretHash();
            var opts = new Options(Operation.RECOVER_ADMIN, null, null, before.id(), "fixture", UUID.randomUUID(), false);
            service.recoverAdmin(opts, next);
            var rebuilt = new JdbcIdentityStore(source, new TransactionTemplate(new DataSourceTransactionManager(source)));
            assertThat(rebuilt.findPrincipalById(before.id()).orElseThrow().lastLoginAt()).isEqualTo(before.lastLoginAt());
            var credential = rebuilt.findPasswordCredential(before.id()).orElseThrow();
            assertThat(credential.secretHash()).startsWith("$argon2id$").isNotEqualTo(oldHash);
            assertThat(hasher.matches(new String(old), credential.secretHash())).isFalse();
            assertThat(hasher.matches(new String(next), credential.secretHash())).isTrue();
            assertThat(rebuilt.findSessionByTokenHash(oldTokenHash).orElseThrow().revoked()).isTrue();
            var newAuth = new AuthService(rebuilt, hasher, properties, new AuthorizationService(rebuilt, new ObjectMapper(), transactions), transactions);
            var filter = new com.fallrising.cms.identity.web.IdentityRequestFilter(rebuilt, properties, newAuth);
            var http = new org.springframework.mock.web.MockHttpServletRequest("GET", "/api/v1/identity/me");
            http.setCookies(new jakarta.servlet.http.Cookie("cms_session", login.sessionToken()));
            try {
                filter.doFilter(http, new org.springframework.mock.web.MockHttpServletResponse(), (req, res) -> {
                    var identity = (IdentityRequest) req.getAttribute(com.fallrising.cms.identity.web.IdentityErrorWriter.ATTR);
                    assertThat(identity.principal()).isNull(); assertThat(identity.tokenState()).isEqualTo(IdentityRequest.TokenState.REVOKED);
                });
            } catch (java.io.IOException | jakarta.servlet.ServletException failure) { throw new AssertionError(failure); }
            assertThatThrownBy(() -> newAuth.login("pp1.root", new String(old), request)).isInstanceOf(com.fallrising.cms.identity.IdentityException.class);
            assertThat(newAuth.login("pp1.root", new String(next), request).principal().id()).isEqualTo(before.id());
            assertThat(rebuilt.listAudits("PRODUCTION_ADMIN_RECOVERED", before.id())).hasSize(1);
        } finally { Arrays.fill(old, '\0'); Arrays.fill(next, '\0'); }
    }

    @Test
    void PP1AC02_realHashNewLoginAndAnonymousNeedsExplicitGrant() {
        var source = PostgresFixture.cleanDataSource();
        var store = new JdbcIdentityStore(source, new TransactionTemplate(new DataSourceTransactionManager(source)));
        var transactions = new TransactionRunner(source);
        var guard = mock(MaintenanceGuard.class); var lease = mock(MaintenanceGuard.Lease.class);
        when(guard.acquire(anyString(), any(UUID.class), any(Operation.class))).thenReturn(lease);
        when(lease.targetId()).thenReturn("fixture"); when(lease.releaseId()).thenReturn("sha256:fixture");
        var options = new Options(Operation.FRESH_INIT, "pp1.root", "PP1 root", null, "fixture", UUID.randomUUID(), false);
        var properties = new IdentityProperties(); properties.setSeedEnabled(false);
        var hasher = new PasswordHasher(properties); char[] raw = UUID.randomUUID().toString().toCharArray();
        try {
            var service = new ProductionIdentityService(store, hasher, transactions, new AuditLog(store, new ObjectMapper()), guard);
            var result = service.freshInit(options, raw);
            var rebuilt = new JdbcIdentityStore(source, new TransactionTemplate(new DataSourceTransactionManager(source)));
            var credential = rebuilt.findPasswordCredential(result.principalId()).orElseThrow();
            assertThat(credential.secretHash()).startsWith("$argon2id$");
            assertThat(hasher.matches(new String(raw), credential.secretHash())).isTrue();
            var authorization = new AuthorizationService(rebuilt, new ObjectMapper(), transactions);
            assertThatThrownBy(() -> authorization.require(null, CmsAction.READ_PUBLISHED, "page", null, Surface.FRONT))
                    .isInstanceOf(com.fallrising.cms.identity.IdentityException.class);
            var auth = new AuthService(rebuilt, hasher, properties, authorization, transactions);
            var request = new IdentityRequest(); request.setSurface(Surface.ADMIN);
            assertThat(auth.login("pp1.root", new String(raw), request).principal().id()).isEqualTo(result.principalId());
            var anonymous = rebuilt.findRoleByCode("anonymous").orElseThrow();
            rebuilt.insertPermission(new Permission(UUID.randomUUID(), anonymous.id(), "read_published", "page", null, List.of("front"), java.time.Instant.now()));
            assertThatCode(() -> authorization.require(null, CmsAction.READ_PUBLISHED, "page", null, Surface.FRONT)).doesNotThrowAnyException();
            assertThat(authorization.allow(null, CmsAction.READ_PUBLISHED, "album", null, Surface.FRONT).allowed()).isFalse();
        } finally { Arrays.fill(raw, '\0'); }
    }
}
