package com.fallrising.cms.contract;

import com.fallrising.cms.identity.IdentityException;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.SessionTokens;
import com.fallrising.cms.identity.domain.AuditEvent;
import com.fallrising.cms.identity.domain.Principal;
import com.fallrising.cms.identity.domain.PrincipalRoleAssignment;
import com.fallrising.cms.identity.domain.PrincipalStatus;
import com.fallrising.cms.identity.domain.SessionRecord;
import com.fallrising.cms.identity.domain.Surface;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.service.AuthService;
import com.fallrising.cms.identity.service.AuthorizationService;
import com.fallrising.cms.identity.service.ContentTypeDirectory;
import com.fallrising.cms.identity.service.PrincipalAdminService;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.identity.web.IdentityRequest;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Existing identity event names and state remain atomic when the audit insert fails after reaching PostgreSQL. */
class IdentityAuditAtomicWriteTests {
    private static final String PASSWORD = "valid-testing-password";
    private JdbcIdentityStore store;
    private JdbcTemplate jdbc;
    private Principal principal;
    private SessionRecord session;
    private IdentityRequest request;
    private AuthService auth;
    private PrincipalAdminService admin;
    private TransactionRunner transactions;
    private boolean failAudit;

    @BeforeEach
    void setUp() {
        var source = PostgresFixture.cleanDataSource();
        jdbc = new JdbcTemplate(source);
        var template = new TransactionTemplate(new DataSourceTransactionManager(source));
        store = new JdbcIdentityStore(source, template) {
            @Override public void insertAudit(AuditEvent event) {
                super.insertAudit(event);
                if (failAudit) throw new IllegalStateException("injected identity audit failure");
            }
        };
        transactions = new TransactionRunner(source);
        var mapper = new ObjectMapper();
        var authorization = new AuthorizationService(store, mapper, transactions);
        PasswordHasher hasher = mock(PasswordHasher.class);
        when(hasher.hash(anyString())).thenAnswer(call -> "encoded:" + call.getArgument(0));
        when(hasher.matches(anyString(), anyString())).thenAnswer(call ->
                ("encoded:" + call.getArgument(0)).equals(call.getArgument(1)));
        when(hasher.dummyHash()).thenReturn("encoded:unused");
        when(hasher.algo()).thenReturn("argon2id");
        auth = new AuthService(store, hasher, new IdentityProperties(), authorization, transactions);
        admin = new PrincipalAdminService(store, hasher, auth, authorization, mapper,
                mock(ContentTypeDirectory.class), transactions, new AuditLog(store, mapper));
        var adminRole = IdentityStoreContract.role("admin");
        store.insertRole(adminRole);
        store.insertPermission(IdentityStoreContract.permission(adminRole.id(), "manage_principals", null, null,
                List.of("admin")));
        var administrator = IdentityStoreContract.principal("root");
        store.insertPrincipal(administrator);
        store.replacePrincipalRoles(administrator.id(), List.of(new PrincipalRoleAssignment(administrator.id(),
                adminRole.id(), "admin", List.of())));
        principal = IdentityStoreContract.principal("subject");
        store.insertPrincipal(principal);
        store.upsertPasswordCredential(principal.id(), "encoded:" + PASSWORD, "argon2id");
        session = IdentityStoreContract.session(principal.id(), new byte[]{1, 2, 3}, Instant.now().plusSeconds(3600));
        store.insertSession(session);
        session = store.findSessionByTokenHash(session.tokenHash()).orElseThrow();
        request = new IdentityRequest();
        request.setPrincipal(administrator);
        request.setSurface(Surface.ADMIN);
        request.setIp("127.0.0.1");
        failAudit = true;
    }

    @Test
    void accountCreateAuditFailureRollsBackPrincipalAndCredential() {
        assertAuditFailure(() -> admin.create(request, "newsubject", "New subject", null, PASSWORD));
        assertThat(store.findPrincipalByUsername("newsubject")).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_credential", Long.class)).isEqualTo(1);
        assertNoAudit();
    }

    @Test
    void accountDisableAndPatchDisableAuditFailureRollBackStatusAndSessions() {
        for (Runnable action : List.<Runnable>of(() -> admin.disable(request, principal.id()),
                () -> admin.patch(request, principal.id(), "Changed", null, "disabled"))) {
            assertAuditFailure(action);
            assertThat(store.findPrincipalById(principal.id())).contains(principal);
            assertSessionUnchanged();
            assertNoAudit();
        }
    }

    @Test
    void assignedRolesAuditFailureRollsBackRoleRows() {
        var member = IdentityStoreContract.role("member");
        store.insertRole(member);
        assertAuditFailure(() -> admin.replaceRoles(request, principal.id(),
                List.of(new PrincipalAdminService.RoleAssignmentInput("member", List.of()))));
        assertThat(store.rolesOf(principal.id())).isEmpty();
        assertNoAudit();
    }

    @Test
    void adminPasswordAuditFailureRollsBackCredentialAndSessions() {
        var credential = store.findPasswordCredential(principal.id()).orElseThrow();
        assertAuditFailure(() -> admin.setPassword(request, principal.id(), "changed-test-password"));
        assertThat(store.findPasswordCredential(principal.id())).contains(credential);
        assertSessionUnchanged();
        assertNoAudit();
    }

    @Test
    void ownPasswordAuditFailureRollsBackCredentialAndSessions() {
        request.setPrincipal(principal);
        request.setSession(session);
        var credential = store.findPasswordCredential(principal.id()).orElseThrow();
        assertAuditFailure(() -> auth.changePassword(request, PASSWORD, "changed-test-password"));
        assertThat(store.findPasswordCredential(principal.id())).contains(credential);
        assertSessionUnchanged();
        assertNoAudit();
    }

    @Test
    void loginSuccessAuditFailureRollsBackPrincipalOldSessionRevocationAndNewSession() {
        principal = principal.withLock(2, null, PrincipalStatus.ACTIVE, IdentityStoreContract.T0);
        store.updatePrincipal(principal);
        assertAuditFailure(() -> auth.login(principal.username(), PASSWORD, request));
        assertThat(store.findPrincipalById(principal.id())).contains(principal);
        assertSessionUnchanged();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_session", Long.class)).isEqualTo(1);
        assertNoAudit();
    }

    @Test
    void loginFailureAuditFailureRollsBackFailureCounterAndLockout() {
        principal = principal.withLock(4, null, PrincipalStatus.ACTIVE, IdentityStoreContract.T0);
        store.updatePrincipal(principal);
        assertAuditFailure(() -> auth.login(principal.username(), "wrong", request));
        assertThat(store.findPrincipalById(principal.id())).contains(principal);
        assertSessionUnchanged();
        assertNoAudit();
    }

    @Test
    void expectedLoginDenialCommitsCounterLockoutAndAuditBeforeThrowing() {
        failAudit = false;
        for (int n = 1; n <= 5; n++) {
            assertThatThrownBy(() -> auth.login(principal.username(), "wrong", request))
                    .isInstanceOfSatisfying(IdentityException.class, failure ->
                            assertThat(failure.code()).isEqualTo(com.fallrising.cms.api.error.ErrorCode.INVALID_CREDENTIALS));
            var stored = store.findPrincipalById(principal.id()).orElseThrow();
            assertThat(stored.failedLoginCount()).isEqualTo(n);
            assertThat(store.listAudits("LOGIN_FAILURE", principal.id())).hasSize(n);
        }
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.LOCKED);
        assertThatThrownBy(() -> auth.login(principal.username(), PASSWORD, request))
                .isInstanceOfSatisfying(IdentityException.class, failure ->
                        assertThat(failure.code()).isEqualTo(com.fallrising.cms.api.error.ErrorCode.ACCOUNT_LOCKED));
        assertThat(store.listAudits("LOGIN_FAILURE", principal.id())).hasSize(6);
        assertThat(store.listAudits("LOGIN_FAILURE", principal.id()).getFirst().detailJson()).contains("locked");
        assertThat(store.listAudits("LOGIN_FAILURE", principal.id()).getFirst().ip()).isEqualTo("127.0.0.1");
    }

    @Test
    void logoutAuditFailureRollsBackSessionRevocation() {
        request.setPrincipal(principal);
        request.setSession(session);
        assertAuditFailure(() -> auth.logout(request));
        assertSessionUnchanged();
        assertNoAudit();
    }

    @Test
    void successfulLoginLogoutAndPasswordChangePreserveEventNamesAndSessionSemantics() {
        failAudit = false;
        var result = auth.login(principal.username(), PASSWORD, request);
        assertThat(store.findSessionByTokenHash(session.tokenHash()).orElseThrow().revokedAt()).isNotNull();
        var active = store.findSessionByTokenHash(SessionTokens.sha256(result.sessionToken())).orElseThrow();
        request.setPrincipal(result.principal());
        request.setSession(active);
        auth.logout(request);
        assertThat(store.findSessionByTokenHash(active.tokenHash()).orElseThrow().revokedAt()).isNotNull();
        auth.changePassword(request, PASSWORD, "changed-test-password");
        assertThat(store.findPasswordCredential(principal.id()).orElseThrow().secretHash()).isEqualTo("encoded:changed-test-password");
        assertThat(store.listAudits("LOGIN_SUCCESS", principal.id())).hasSize(1);
        assertThat(store.listAudits("LOGOUT", principal.id())).hasSize(1);
        assertThat(store.listAudits("PASSWORD_CHANGED", principal.id())).hasSize(1);
    }

    @Test
    void expectedDenialRemainsCommittedWhenAmbientTransactionRollsBack() {
        failAudit = false;
        assertThatThrownBy(() -> transactions.run(() -> auth.login(principal.username(), "wrong", request)))
                .isInstanceOf(IdentityException.class);
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().failedLoginCount()).isEqualTo(1);
        assertThat(store.listAudits("LOGIN_FAILURE", principal.id())).singleElement().satisfies(event -> {
            assertThat(event.outcome()).isEqualTo("denied");
            assertThat(event.ip()).isEqualTo("127.0.0.1");
        });
    }

    @Test
    void missingDisabledAndLockedAccountAuditFailuresLeaveNoAuditOrCounterChanges() {
        assertAuditFailure(() -> auth.login("missing", PASSWORD, request));
        assertNoAudit();
        store.updatePrincipal(principal.withStatus(PrincipalStatus.DISABLED, IdentityStoreContract.T0));
        assertAuditFailure(() -> auth.login(principal.username(), PASSWORD, request));
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().failedLoginCount()).isZero();
        assertThat(store.findPrincipalById(principal.id()).orElseThrow().status()).isEqualTo(PrincipalStatus.DISABLED);
        assertNoAudit();
        store.updatePrincipal(principal.withLock(5, Instant.now().plusSeconds(300), PrincipalStatus.LOCKED, IdentityStoreContract.T0));
        var locked = store.findPrincipalById(principal.id()).orElseThrow();
        assertAuditFailure(() -> auth.login(principal.username(), PASSWORD, request));
        assertThat(store.findPrincipalById(principal.id())).contains(locked);
        assertNoAudit();
    }

    private void assertAuditFailure(Runnable action) {
        assertThatThrownBy(action::run).isInstanceOf(IllegalStateException.class).hasMessage("injected identity audit failure");
    }

    private void assertSessionUnchanged() {
        assertThat(store.findSessionByTokenHash(session.tokenHash()).orElseThrow())
                .usingRecursiveComparison().isEqualTo(session);
    }

    private void assertNoAudit() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM cms_audit_event", Long.class)).isZero();
    }
}
