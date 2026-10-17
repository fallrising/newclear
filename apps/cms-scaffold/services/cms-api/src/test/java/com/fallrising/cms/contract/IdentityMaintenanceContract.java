package com.fallrising.cms.contract;

import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.domain.*;
import com.fallrising.cms.identity.maintenance.MaintenanceGuard;
import com.fallrising.cms.identity.maintenance.ProductionIdentityService;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.store.IdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/** The same account mutation and raw-state contract runs against memory and PostgreSQL. */
public abstract class IdentityMaintenanceContract {
    protected static final Instant T0 = Instant.parse("2026-10-01T00:00:00Z");
    protected IdentityStore store;
    protected TransactionRunner transactions;
    protected String fault;
    protected List<String> lifecycle;
    protected abstract IdentityStore newStore();
    protected abstract Object snapshot();
    protected abstract void removePasswordFixture(UUID principalId);

    @BeforeEach
    void setUpMaintenance() {
        fault = null;
        lifecycle = new CopyOnWriteArrayList<>();
        store = newStore();
    }

    protected Options options() {
        return new Options(Operation.FRESH_INIT, "pp1.root", "PP1 root", null, "fixture", UUID.randomUUID(), false);
    }
    protected char[] password() { return UUID.randomUUID().toString().toCharArray(); }
    protected Role role(String code) { return new Role(UUID.randomUUID(), code, "Existing " + code, true, T0); }
    protected Principal principal(String name, boolean deleted) {
        return new Principal(UUID.randomUUID(), name, name, null, PrincipalStatus.ACTIVE, 0, null, null, T0, T0, deleted ? T0 : null);
    }
    protected AuditEvent event(String action, String detail) {
        return new AuditEvent(UUID.randomUUID(), T0, null, "AUTH", action, "principal", UUID.randomUUID(), "admin", "ok", null, detail);
    }
    protected ProductionIdentityService service() {
        var hasher = mock(PasswordHasher.class);
        when(hasher.hash(any(char[].class))).thenReturn(java.util.UUID.randomUUID().toString());
        when(hasher.algo()).thenReturn("argon2id");
        return service(hasher);
    }
    protected ProductionIdentityService service(PasswordHasher hasher) {
        var guard = mock(MaintenanceGuard.class);
        var lease = mock(MaintenanceGuard.Lease.class);
        when(guard.acquire(anyString(), any(UUID.class), any(Operation.class))).thenReturn(lease);
        when(lease.targetId()).thenReturn("fixture");
        when(lease.releaseId()).thenReturn("sha256:fixture");
        when(lease.backupId()).thenReturn("backup".equals(fault) ? "" : "verified-core-fixture");
        var checks = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(call -> {
            if (checks.incrementAndGet() == 2 && "guard".equals(fault)) throw new Failure(FailureCode.QUIESCENCE_NOT_PROVEN);
            return null;
        }).when(lease).assertQuiesced();
        doAnswer(call -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            // This fake receipt verifies committed state; serialize its reads with memory rollback restoration.
            store.maintenanceTransaction(() -> {
                assertThat(store.countUsableAdmins()).isEqualTo(1);
                assertThat(store.listAudits(((Result) call.getArgument(0)).operation() == Operation.FRESH_INIT
                        ? "PRODUCTION_ADMIN_INITIALIZED" : "PRODUCTION_ADMIN_RECOVERED", null)).hasSize(1);
                return null;
            });
            verify(lease, times(2)).assertQuiesced();
            if ("receipt".equals(fault)) throw new IllegalStateException("receipt fault");
            lifecycle.add("committed"); return null;
        }).when(lease).recordCommitted(any(Result.class));
        doAnswer(call -> { lifecycle.add("close"); if ("close".equals(fault)) throw new IllegalStateException("close fault"); return null; }).when(lease).close();
        return new ProductionIdentityService(store, hasher, transactions, new AuditLog(store, new ObjectMapper()), guard);
    }

    @Test
    void PP1FM04_primitiveRawChecksDeleted() {
        var role = role("admin"); store.insertRole(role);
        assertThat(store.hasIdentityDataIncludingDeleted()).isFalse();
        store.insertPrincipal(principal("deleted.fixture", true));
        assertThat(store.listPrincipals()).isEmpty();
        assertThat(store.hasIdentityDataIncludingDeleted()).isTrue();
    }

    @Test
    void PP1FM04_primitiveOperationLookupIsComplete() {
        UUID operation = UUID.randomUUID();
        store.insertAudit(event("OTHER_ACTION", "{\"operationId\":\"" + operation + "\"}"));
        assertThat(store.hasMaintenanceOperation(operation)).isFalse();
        for (int i = 0; i < 120; i++) store.insertAudit(event("OTHER_ACTION", null));
        store.insertAudit(event("PRODUCTION_ADMIN_RECOVERED", "{\"operationId\":\"" + operation + "\"}"));
        assertThat(store.hasMaintenanceOperation(operation)).isTrue();
        assertThat(store.hasMaintenanceOperation(UUID.randomUUID())).isFalse();
        UUID fresh = UUID.randomUUID();
        store.insertAudit(event("PRODUCTION_ADMIN_INITIALIZED", "{\"operationId\":\"" + fresh + "\"}"));
        assertThat(store.hasMaintenanceOperation(fresh)).isTrue();
    }

    public enum Dirty { PRINCIPAL, DELETED, CREDENTIAL, ASSIGNMENT, PERMISSION, SESSION, AUDIT }
    @ParameterizedTest
    @EnumSource(Dirty.class)
    void PP1FM04_rawDirtyRejectsFreshWithoutChangingAnyObject(Dirty dirty) {
        var admin = role("admin"); store.insertRole(admin);
        var existing = principal("existing.fixture", dirty == Dirty.DELETED);
        if (dirty != Dirty.PERMISSION && dirty != Dirty.AUDIT) store.insertPrincipal(existing);
        switch (dirty) {
            case CREDENTIAL -> store.upsertPasswordCredential(existing.id(), "previous-fixture-hash", "argon2id");
            case ASSIGNMENT -> store.replacePrincipalRoles(existing.id(), List.of(new PrincipalRoleAssignment(existing.id(), admin.id(), "admin", List.of())));
            case PERMISSION -> store.insertPermission(new Permission(UUID.randomUUID(), admin.id(), "manage_principals", null, null, List.of("admin"), T0));
            case SESSION -> store.insertSession(new SessionRecord(UUID.randomUUID(), existing.id(), new byte[]{1, 2, 3}, T0,
                    T0.plusSeconds(100), T0, null, "admin", null, null));
            case AUDIT -> store.insertAudit(event("PREVIOUS_EVENT", null));
            default -> { }
        }
        Object before = snapshot();
        assertThatThrownBy(() -> service().freshInit(options(), password())).isInstanceOf(Failure.class).hasMessage("NOT_FRESH");
        assertThat(snapshot()).isEqualTo(before);
    }

    @Test
    void PP1AC02_freshCreatesOnlyFormalAdminAndPreservesCatalogIds() throws Exception {
        for (String code : List.of("anonymous", "member", "editor", "operator", "admin")) store.insertRole(role(code));
        var roles = store.listRoles();
        var opts = options();
        var result = service().freshInit(opts, password());
        assertThat(store.listRoles()).isEqualTo(roles);
        assertThat(store.listPrincipals()).hasSize(1);
        var principal = store.findPrincipalById(result.principalId()).orElseThrow();
        assertThat(principal.username()).isEqualTo("pp1.root");
        assertThat(principal.status()).isEqualTo(PrincipalStatus.ACTIVE);
        assertThat(principal.email()).isNull(); assertThat(principal.lastLoginAt()).isNull();
        assertThat(principal.failedLoginCount()).isZero(); assertThat(principal.lockedUntil()).isNull();
        assertThat(store.findPasswordCredential(principal.id()).orElseThrow().algo()).isEqualTo("argon2id");
        assertThat(store.rolesOf(principal.id())).containsExactly(new PrincipalRoleAssignment(principal.id(), store.findRoleByCode("admin").orElseThrow().id(), "admin", List.of()));
        var grants = store.permissionsOfRole(store.findRoleByCode("admin").orElseThrow().id());
        assertThat(grants).extracting(Permission::action).containsExactlyInAnyOrder("read_published", "read_draft", "create", "update",
                "publish", "unpublish", "delete", "archive", "manage_media", "manage_types", "manage_principals", "manage_settings", "read_audit");
        for (var permission : grants) {
            assertThat(permission.contentTypeCode()).isNull(); assertThat(permission.predicateJson()).isNull();
            var expected = permission.action().equals("read_published") ? List.of("front", "back", "admin")
                    : List.of("manage_types", "manage_principals", "manage_settings", "read_audit").contains(permission.action()) ? List.of("admin") : List.of("back", "admin");
            assertThat(permission.allowedSurfaces()).isEqualTo(expected);
        }
        for (String code : List.of("anonymous", "member", "editor", "operator"))
            assertThat(store.permissionsOfRole(store.findRoleByCode(code).orElseThrow().id())).isEmpty();
        var audit = store.listAudits("PRODUCTION_ADMIN_INITIALIZED", null);
        assertThat(audit).hasSize(1);
        assertThat(audit.getFirst().actorPrincipalId()).isNull();
        assertThat(audit.getFirst().targetId()).isEqualTo(principal.id());
        var detail = new ObjectMapper().readTree(audit.getFirst().detailJson());
        assertThat(detail.size()).isEqualTo(4);
        assertThat(detail.get("operationId").asText()).isEqualTo(opts.operationId().toString());
        assertThat(detail.get("mode").asText()).isEqualTo("FRESH_INIT");
        assertThat(lifecycle).containsExactly("committed", "close");
    }

    @Test
    void PP1FM04_repeatPreservesEveryObject() {
        var service = service(); var opts = options();
        service.freshInit(opts, password());
        Object before = snapshot();
        assertThatThrownBy(() -> service.freshInit(opts, password())).isInstanceOf(Failure.class).hasMessage("NOT_FRESH");
        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @CsvSource({"custom,true", "admin,false"})
    void PP1FM04_customAndNonSystemRolesRejectFresh(String code, boolean system) {
        store.insertRole(new Role(UUID.randomUUID(), code, "Existing", system, T0));
        Object before = snapshot();
        assertThatThrownBy(() -> service().freshInit(options(), password())).isInstanceOf(Failure.class).hasMessage("NOT_FRESH");
        assertThat(snapshot()).isEqualTo(before);
    }

    protected void afterWrite(String point) {
        if (point.equals(fault)) throw new IllegalStateException("injected after-write fault");
    }

    @ParameterizedTest
    @ValueSource(strings = {"credential", "assignment", "audit", "guard"})
    void PP1FM04_freshFaultsRestoreFullSnapshot(String point) {
        for (String code : List.of("anonymous", "member", "editor", "operator", "admin")) store.insertRole(role(code));
        Object before = snapshot(); fault = point;
        assertThatThrownBy(() -> service().freshInit(options(), password())).isInstanceOf(Failure.class)
                .hasMessage(point.equals("guard") ? "QUIESCENCE_NOT_PROVEN" : "MAINTENANCE_INTERNAL_ERROR");
        assertThat(snapshot()).isEqualTo(before);
        fault = null;
        service().freshInit(options(), password());
        assertThat(store.findPrincipalByUsername("pp1.root")).isPresent();
    }

    @ParameterizedTest
    @ValueSource(strings = {"receipt", "close"})
    void PP1FM04_commitKnownReceiptAndCloseFaultNeverReplay(String point) {
        var service = service(); var opts = options(); fault = point;
        assertThatThrownBy(() -> service.freshInit(opts, password())).isInstanceOf(Failure.class).hasMessage("COMMITTED_HOST_RESTORE_FAILED");
        assertThat(store.countUsableAdmins()).isEqualTo(1);
        assertThat(store.listAudits("PRODUCTION_ADMIN_INITIALIZED", null)).hasSize(1);
        Object committed = snapshot(); fault = null;
        assertThatThrownBy(() -> service.freshInit(opts, password())).hasMessage("NOT_FRESH");
        assertThat(snapshot()).isEqualTo(committed);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void PP1FM04_primitiveTransactionRollsBack(boolean fatal) {
        var admin = role("admin"); store.insertRole(admin);
        var existing = principal("existing.fixture", false); store.insertPrincipal(existing);
        store.upsertPasswordCredential(existing.id(), "baseline-fixture-hash", "argon2id");
        store.replacePrincipalRoles(existing.id(), List.of(new PrincipalRoleAssignment(existing.id(), admin.id(), "admin", List.of("page"))));
        store.insertPermission(new Permission(UUID.randomUUID(), admin.id(), "manage_principals", null, null, List.of("admin"), T0));
        var session = new SessionRecord(UUID.randomUUID(), existing.id(), new byte[]{1, 2, 3}, T0, T0.plusSeconds(100), T0, null, "admin", null, null);
        store.insertSession(session); store.insertAudit(event("BASELINE", null));
        Object before = snapshot();
        assertThatThrownBy(() -> store.maintenanceTransaction(() -> {
            store.updatePrincipal(existing.withLock(2, T0.plusSeconds(30), PrincipalStatus.LOCKED, T0.plusSeconds(1)));
            store.upsertPasswordCredential(existing.id(), "changed-fixture-hash", "argon2id");
            store.replacePrincipalRoles(existing.id(), List.of()); store.replaceRolePermissions(admin.id(), List.of());
            store.insertRole(role("custom")); store.insertPrincipal(principal("new.fixture", false));
            store.revokeSession(session.id(), T0.plusSeconds(1)); store.insertAudit(event("NEW_EVENT", null));
            if (fatal) throw new AssertionError("injected fatal fault");
            throw new IllegalStateException("injected runtime fault");
        })).isInstanceOf(fatal ? AssertionError.class : IllegalStateException.class);
        assertThat(snapshot()).isEqualTo(before);
        assertThat(store.findSessionByTokenHash(session.tokenHash()).orElseThrow().revokedAt()).isNull();
        assertThat(store.findPrincipalByUsername("new.fixture")).isEmpty();
    }

    @Test
    void PP1FM04_primitiveGuardSerializesOrTimesOut() throws Exception {
        var entered = new CountDownLatch(1); var release = new CountDownLatch(1);
        var started = new CountDownLatch(1); var secondEntered = new CountDownLatch(1);
        var executor = Executors.newFixedThreadPool(2);
        try {
            var first = executor.submit(() -> store.maintenanceTransaction(() -> {
                entered.countDown(); await(release); return 1;
            }));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            var second = executor.submit(() -> { started.countDown(); return store.maintenanceTransaction(() -> {
                secondEntered.countDown(); return 2;
            }); });
            assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(secondEntered.await(100, TimeUnit.MILLISECONDS)).isFalse();
            release.countDown();
            assertThat(first.get(10, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(2);
        } finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void PP1FM04_concurrentFreshCommitsOnce() throws Exception {
        var start = new CountDownLatch(1); var ready = new CountDownLatch(2);
        var executor = Executors.newFixedThreadPool(2);
        java.util.concurrent.Callable<Integer> attempt = () -> {
            ready.countDown(); await(start);
            try { service().freshInit(options(), password()); return 0; }
            catch (Failure failure) { assertThat(failure.code()).isEqualTo(FailureCode.NOT_FRESH); return 3; }
        };
        try {
            var first = executor.submit(attempt); var second = executor.submit(attempt);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS))).containsExactlyInAnyOrder(0, 3);
            assertThat(store.listPrincipals()).hasSize(1);
            assertThat(store.listAudits("PRODUCTION_ADMIN_INITIALIZED", null)).hasSize(1);
        } finally { start.countDown(); executor.shutdownNow(); }
    }

    @ParameterizedTest
    @ValueSource(strings = {"options", "short", "username", "hash"})
    void PP1FM04_prewriteFailuresNeverAcquireGuard(String point) {
        var guard = mock(MaintenanceGuard.class); var hasher = mock(PasswordHasher.class);
        when(hasher.hash(any(char[].class))).thenThrow(new IllegalStateException("hash fault"));
        var service = new ProductionIdentityService(store, hasher, transactions, new AuditLog(store, new ObjectMapper()), guard);
        var normal = options();
        var opts = point.equals("options") ? new Options(Operation.FRESH_INIT, "seed-root", normal.displayName(), null,
                normal.targetId(), normal.operationId(), false) : point.equals("username")
                ? new Options(Operation.FRESH_INIT, "administrator", normal.displayName(), null, normal.targetId(), normal.operationId(), false) : normal;
        char[] raw = point.equals("short") ? new char[]{'s'} : point.equals("username") ? "ADMINISTRATOR".toCharArray() : password();
        Object before = snapshot();
        try {
            assertThatThrownBy(() -> service.freshInit(opts, raw)).isInstanceOf(Failure.class)
                    .hasMessage(point.equals("options") ? "INPUT_INVALID" : point.equals("hash") ? "MAINTENANCE_INTERNAL_ERROR" : "SECRET_INPUT_INVALID");
            verifyNoInteractions(guard);
            if (!point.equals("hash")) verifyNoInteractions(hasher);
            assertThat(snapshot()).isEqualTo(before);
        } finally { java.util.Arrays.fill(raw, '\0'); }
    }

    @Test
    void PP1FM04_precommitCleanupDoesNotReplaceGuardDenial() {
        var guard = mock(MaintenanceGuard.class); var lease = mock(MaintenanceGuard.Lease.class);
        when(guard.acquire(anyString(), any(UUID.class), any(Operation.class))).thenReturn(lease);
        doThrow(new Failure(FailureCode.QUIESCENCE_NOT_PROVEN)).when(lease).assertQuiesced();
        doThrow(new IllegalStateException("cleanup fault")).when(lease).close();
        var hasher = mock(PasswordHasher.class); when(hasher.hash(any(char[].class))).thenReturn("test-only-encoded");
        var service = new ProductionIdentityService(store, hasher, transactions, new AuditLog(store, new ObjectMapper()), guard);
        Object before = snapshot();
        assertThatThrownBy(() -> service.freshInit(options(), password())).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");
        verify(lease).close(); verify(lease, never()).recordCommitted(any(Result.class));
        assertThat(snapshot()).isEqualTo(before);
    }

    protected record RecoveryFixture(Principal target, Principal other, List<SessionRecord> sessions) {}
    protected RecoveryFixture recoveryFixture(PrincipalStatus status) {
        var normal = options();
        var initialized = service().freshInit(new Options(Operation.FRESH_INIT, "administrator", "Formal root", null,
                normal.targetId(), normal.operationId(), false), password());
        var p = store.findPrincipalById(initialized.principalId()).orElseThrow();
        var target = store.updatePrincipal(new Principal(p.id(), p.username(), p.displayName(), "fixture@example.test", status,
                status == PrincipalStatus.LOCKED ? 5 : status == PrincipalStatus.ACTIVE ? 2 : 0,
                status == PrincipalStatus.LOCKED ? T0.plusSeconds(900) : null, T0.minusSeconds(86400), p.createdAt(), T0, null));
        var other = store.insertPrincipal(principal("other.fixture", false));
        var sessions = List.of(session(target.id(), null), session(target.id(), null), session(target.id(), T0), session(other.id(), null));
        sessions.forEach(store::insertSession);
        assertThat(sessions.subList(0, 2)).allMatch(session -> !session.revoked() && !session.expired(Instant.now()));
        lifecycle.clear();
        return new RecoveryFixture(target, other, sessions);
    }
    protected SessionRecord session(UUID principal, Instant revoked) {
        UUID token = UUID.randomUUID();
        return new SessionRecord(UUID.randomUUID(), principal, java.nio.ByteBuffer.allocate(16)
                .putLong(token.getMostSignificantBits()).putLong(token.getLeastSignificantBits()).array(), T0,
                Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS).plusSeconds(3600), T0, revoked, "admin", null, null);
    }
    protected Options recoveryOptions(UUID id, boolean reenable) {
        return new Options(Operation.RECOVER_ADMIN, null, null, id, "fixture", UUID.randomUUID(), reenable);
    }

    @ParameterizedTest
    @CsvSource({"ACTIVE,false", "ACTIVE,true", "LOCKED,false", "LOCKED,true", "DISABLED,true"})
    void PP1AC02_recoveryPreservesIdentityAndRevokesOnlyActiveOwnSessions(PrincipalStatus status, boolean reenable) throws Exception {
        var fixture = recoveryFixture(status); var p = fixture.target(); var opts = recoveryOptions(p.id(), reenable);
        var roles = store.listRoles(); var assignments = store.rolesOf(p.id());
        var grants = store.permissionsOfRole(store.findRoleByCode("admin").orElseThrow().id());
        var previousHash = store.findPasswordCredential(p.id()).orElseThrow().secretHash();
        var result = service().recoverAdmin(opts, password());
        assertThat(result.principalId()).isEqualTo(p.id()); assertThat(result.operation()).isEqualTo(Operation.RECOVER_ADMIN);
        assertThat(store.findPrincipalById(p.id()).orElseThrow()).isEqualTo(p.withLock(0, null, PrincipalStatus.ACTIVE,
                store.findPrincipalById(p.id()).orElseThrow().updatedAt()));
        assertThat(store.findPasswordCredential(p.id()).orElseThrow().secretHash()).isNotEqualTo(previousHash);
        assertThat(store.listRoles()).isEqualTo(roles); assertThat(store.rolesOf(p.id())).isEqualTo(assignments);
        assertThat(store.permissionsOfRole(store.findRoleByCode("admin").orElseThrow().id())).isEqualTo(grants);
        assertThat(store.findPrincipalById(fixture.other().id()).orElseThrow()).isEqualTo(fixture.other());
        for (int i = 0; i < fixture.sessions().size(); i++) {
            var old = fixture.sessions().get(i); var current = store.findSessionByTokenHash(old.tokenHash()).orElseThrow();
            if (i < 2) assertThat(current.revokedAt()).isNotNull();
            else assertThat(current.revokedAt()).isEqualTo(old.revokedAt());
            assertThat(current).usingRecursiveComparison().isEqualTo(old.revoke(current.revokedAt()));
        }
        var events = store.listAudits("PRODUCTION_ADMIN_RECOVERED", null); assertThat(events).hasSize(1);
        var event = events.getFirst(); assertThat(event.actorPrincipalId()).isNull(); assertThat(event.targetId()).isEqualTo(p.id());
        assertThat(event.category()).isEqualTo("AUTH"); assertThat(event.surface()).isEqualTo("admin"); assertThat(event.outcome()).isEqualTo("ok");
        var detail = new ObjectMapper().readTree(event.detailJson()); assertThat(detail.size()).isEqualTo(5);
        assertThat(detail.get("operationId").asText()).isEqualTo(opts.operationId().toString());
        assertThat(detail.get("backupId").asText()).isEqualTo("verified-core-fixture");
        assertThat(detail.get("reenable").asBoolean()).isEqualTo(reenable);
        assertThat(lifecycle).containsExactly("committed", "close");
    }

    @ParameterizedTest
    @ValueSource(strings = {"disabled", "nonadmin", "deleted", "missing", "grants", "surface"})
    void PP1FM04_recoveryNeverPromotesCreatesOrRepairs(String reason) {
        var fixture = recoveryFixture(reason.equals("disabled") ? PrincipalStatus.DISABLED : PrincipalStatus.ACTIVE);
        UUID id = fixture.target().id();
        if (reason.equals("nonadmin")) id = fixture.other().id();
        if (reason.equals("missing")) id = UUID.randomUUID();
        if (reason.equals("deleted")) {
            var p = fixture.target(); store.updatePrincipal(new Principal(p.id(), p.username(), p.displayName(), p.email(), p.status(),
                    p.failedLoginCount(), p.lockedUntil(), p.lastLoginAt(), p.createdAt(), p.updatedAt(), T0));
        }
        if (reason.equals("grants") || reason.equals("surface")) {
            var admin = store.findRoleByCode("admin").orElseThrow();
            store.replaceRolePermissions(admin.id(), reason.equals("grants") ? List.of() : List.of(new Permission(UUID.randomUUID(),
                    admin.id(), "manage_principals", null, null, List.of("back"), T0)));
        }
        Object before = snapshot(); var opts = recoveryOptions(id, false);
        assertThatThrownBy(() -> service().recoverAdmin(opts, password())).isInstanceOf(Failure.class)
                .hasMessage(reason.equals("disabled") ? "TARGET_DISABLED" : List.of("grants", "surface").contains(reason)
                        ? "ADMIN_GRANTS_DAMAGED" : "TARGET_NOT_ADMIN");
        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"credential", "principal", "revoke", "audit", "guard", "hash"})
    void PP1FM04_recoveryFaultsRestoreFullSnapshot(String point) {
        var fixture = recoveryFixture(PrincipalStatus.LOCKED); Object before = snapshot(); fault = point;
        var hasher = mock(PasswordHasher.class); when(hasher.algo()).thenReturn("argon2id");
        if (point.equals("hash")) when(hasher.hash(any(char[].class))).thenThrow(new IllegalStateException("hash fault"));
        else when(hasher.hash(any(char[].class))).thenReturn("rotated-test-only-encoded");
        assertThatThrownBy(() -> service(hasher).recoverAdmin(recoveryOptions(fixture.target().id(), false), password()))
                .isInstanceOf(Failure.class).hasMessage(point.equals("guard") ? "QUIESCENCE_NOT_PROVEN" : "MAINTENANCE_INTERNAL_ERROR");
        assertThat(snapshot()).isEqualTo(before); fault = null;
    }

    @ParameterizedTest
    @ValueSource(strings = {"administrator", "ADMINISTRATOR"})
    void PP1FM04_recoverPasswordCannotEqualActualUsername(String input) {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); Object before = snapshot(); var hasher = mock(PasswordHasher.class);
        char[] raw = input.toCharArray();
        try {
            assertThatThrownBy(() -> service(hasher).recoverAdmin(recoveryOptions(fixture.target().id(), false), raw))
                    .isInstanceOf(Failure.class).hasMessage("SECRET_INPUT_INVALID");
            verifyNoInteractions(hasher); assertThat(snapshot()).isEqualTo(before);
        } finally { java.util.Arrays.fill(raw, '\0'); }
    }

    @ParameterizedTest
    @ValueSource(strings = {"PRODUCTION_ADMIN_INITIALIZED", "PRODUCTION_ADMIN_RECOVERED"})
    void PP1FM04_recoveryDuplicateAcrossTargetsDoesNotWrite(String action) {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); var opts = recoveryOptions(fixture.target().id(), false);
        store.insertAudit(event(action, "{\"operationId\":\"" + opts.operationId() + "\"}")); Object before = snapshot();
        assertThatThrownBy(() -> service().recoverAdmin(opts, password())).isInstanceOf(Failure.class).hasMessage("DUPLICATE_OPERATION");
        assertThat(snapshot()).isEqualTo(before);
    }

    @Test
    void PP1FM04_duplicateRecoveryRaceCommitsOnce() throws Exception {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); var opts = recoveryOptions(fixture.target().id(), false);
        var start = new CountDownLatch(1); var ready = new CountDownLatch(2); var executor = Executors.newFixedThreadPool(2);
        java.util.concurrent.Callable<Integer> attempt = () -> {
            ready.countDown(); await(start);
            try { service().recoverAdmin(opts, password()); return 0; }
            catch (Failure failure) { assertThat(failure.code()).isEqualTo(FailureCode.DUPLICATE_OPERATION); return 3; }
        };
        try {
            var first = executor.submit(attempt); var second = executor.submit(attempt);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS))).containsExactlyInAnyOrder(0, 3);
            assertThat(store.listAudits("PRODUCTION_ADMIN_RECOVERED", null)).hasSize(1);
        } finally { start.countDown(); executor.shutdownNow(); }
    }

    @Test
    void PP1FM04_recoveryRequiresVerifiedBackupLease() {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); Object before = snapshot(); fault = "backup";
        assertThatThrownBy(() -> service().recoverAdmin(recoveryOptions(fixture.target().id(), false), password()))
                .isInstanceOf(Failure.class).hasMessage("RECOVERY_BACKUP_REQUIRED");
        assertThat(snapshot()).isEqualTo(before);
    }

    @Test
    void PP1AC02_recoveryCanSupplyMissingPasswordCredential() {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); removePasswordFixture(fixture.target().id());
        assertThat(store.findPasswordCredential(fixture.target().id())).isEmpty();
        service().recoverAdmin(recoveryOptions(fixture.target().id(), false), password());
        assertThat(store.findPasswordCredential(fixture.target().id())).isPresent();
        assertThat(store.rolesOf(fixture.other().id())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"receipt", "close"})
    void PP1FM04_recoveryCommitKnownFaultCannotReplay(String point) {
        var fixture = recoveryFixture(PrincipalStatus.ACTIVE); var opts = recoveryOptions(fixture.target().id(), false); fault = point;
        assertThatThrownBy(() -> service().recoverAdmin(opts, password())).isInstanceOf(Failure.class).hasMessage("COMMITTED_HOST_RESTORE_FAILED");
        assertThat(store.listAudits("PRODUCTION_ADMIN_RECOVERED", null)).hasSize(1); Object before = snapshot(); fault = null;
        assertThatThrownBy(() -> service().recoverAdmin(opts, password())).isInstanceOf(Failure.class).hasMessage("DUPLICATE_OPERATION");
        assertThat(snapshot()).isEqualTo(before);
    }

    protected static void await(CountDownLatch latch) {
        try { if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("latch timeout"); }
        catch (InterruptedException exception) { Thread.currentThread().interrupt(); throw new AssertionError("interrupted"); }
    }
}
