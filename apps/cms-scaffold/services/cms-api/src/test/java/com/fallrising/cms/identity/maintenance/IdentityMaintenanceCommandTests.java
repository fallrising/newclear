package com.fallrising.cms.identity.maintenance;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.Arguments;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import java.nio.CharBuffer;
import java.util.Arrays;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.crypto.PasswordPolicy;
import com.zaxxer.hikari.HikariDataSource;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fallrising.cms.platform.TransactionRunner;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.Statement;
import java.sql.ResultSet;
import java.util.Map;
import java.util.HashMap;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import static org.mockito.Mockito.*;

import static org.assertj.core.api.Assertions.*;
import static com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand.*;

class IdentityMaintenanceCommandTests {
    private static final String OP = "10000000-0000-0000-0000-000000000001";
    private static String[] fresh() {
        return new String[]{"fresh-init", "--username", "PP1.Root", "--display-name", "PP1 root", "--target-id",
                "pp1-local:test", "--operation-id", OP, "--confirm", "FRESH_INIT"};
    }

    @ParameterizedTest
    @MethodSource("invalidOptions")
    void PP1FM04_invalidOptionsHaveFixedInputFailure(String[] args) {
        assertThatThrownBy(() -> parse(args)).isInstanceOf(Failure.class).hasMessage("INPUT_INVALID");
    }

    static Stream<Arguments> invalidOptions() {
        var cases = new ArrayList<String[]>();
        cases.add(new String[0]);
        for (String[] extra : List.of(new String[]{"--password", "secret-canary"},
                new String[]{"--username", "duplicate"}, new String[]{"--reenable"},
                new String[]{"--spring.profiles.active", "dev"}, new String[]{"--unknown"})) {
            var args = new ArrayList<>(List.of(fresh()));
            args.addAll(List.of(extra));
            cases.add(args.toArray(String[]::new));
        }
        for (int index : new int[]{2, 4, 6, 8, 10}) {
            var args = fresh();
            args[index] = index == 2 ? "seed-admin" : index == 8 ? "1-1-1-1-1" : " ";
            cases.add(args);
        }
        var spaced = fresh(); spaced[10] = "FRESH_INIT "; cases.add(spaced);
        cases.add(new String[]{"maintenance", "fresh-init"});
        return cases.stream().map(args -> Arguments.of((Object) args));
    }

    @Test
    void PP1FM04_parserKeepsNonSecretCanonicalOptions() {
        var options = parse(fresh());
        assertThat(options.operation()).isEqualTo(Operation.FRESH_INIT);
        assertThat(options.username()).isEqualTo("pp1.root");
        assertThat(options.operationId()).isEqualTo(UUID.fromString(OP));
        assertThat(options.reenable()).isFalse();
    }

    @Test
    void PP1FM04_defaultGuardDeniesBothConnectionAndLease() {
        var guard = MaintenanceGuard.defaultDeny();
        assertThatThrownBy(guard::connectionPhase).isInstanceOf(Failure.class).hasMessage("HOST_GUARD_NOT_CONFIGURED");
        assertThatThrownBy(() -> guard.acquire("test", UUID.fromString(OP), Operation.FRESH_INIT))
                .isInstanceOf(Failure.class).hasMessage("HOST_GUARD_NOT_CONFIGURED");
        assertThat(FailureCode.HOST_GUARD_NOT_CONFIGURED.exitCode()).isEqualTo(6);
    }

    @Test
    void PP1FM04_missingConsoleHasNoFallback() {
        assertThat(System.console()).isNull();
        assertThatThrownBy(() -> new ConsoleSecretInput().readAndConfirm("pp1.root"))
                .isInstanceOf(Failure.class).hasMessage("SECRET_INPUT_INVALID");
    }

    @Test
    void PP1FM04_passwordPolicyPreservesUtf16AndCaseInsensitiveRules() {
        assertThatThrownBy(() -> PasswordPolicy.validate(null, null)).hasMessage("Password must be at least 12 characters");
        assertThatThrownBy(() -> PasswordPolicy.validate(null, "short")).hasMessage("Password must be at least 12 characters");
        assertThatThrownBy(() -> PasswordPolicy.validate("LongUserName", CharBuffer.wrap("LONGUSERNAME")))
                .hasMessage("Password must not equal username");
        assertThatCode(() -> PasswordPolicy.validate(null, "😀".repeat(6))).doesNotThrowAnyException();
        assertThatThrownBy(() -> PasswordPolicy.validate("𐐀".repeat(6), "𐐨".repeat(6)))
                .hasMessage("Password must not equal username");
        char[] raw = UUID.randomUUID().toString().toCharArray();
        var hasher = new PasswordHasher(new IdentityProperties());
        assertThat(hasher.matches(new String(raw), hasher.hash(raw))).isTrue();
        Arrays.fill(raw, '\0');
    }

    @Test
    void PP1FM04_secretSuccessUsesFixedPromptsAndClearsConfirmation() {
        char[] first = UUID.randomUUID().toString().toCharArray(), second = first.clone();
        var prompts = new ArrayList<String>();
        var input = new ConsoleSecretInput(prompt -> { prompts.add(prompt); return prompts.size() == 1 ? first : second; });
        assertThat(input.readAndConfirm("pp1.root")).isSameAs(first);
        assertThat(prompts).containsExactly("New password: ", "Confirm password: ");
        assertThat(second).containsOnly('\0');
        Arrays.fill(first, '\0');
    }

    @Test
    void PP1FM04_secretFailuresClearEveryOwnedBufferWithoutEcho() {
        for (String mode : List.of("mismatch", "policy", "read", "eof")) {
            char[] first = (mode.equals("policy") ? "short" : UUID.randomUUID().toString()).toCharArray();
            char[] second = mode.equals("mismatch") ? UUID.randomUUID().toString().toCharArray() : first.clone();
            String canary = new String(first);
            var calls = new java.util.concurrent.atomic.AtomicInteger();
            var input = new ConsoleSecretInput(prompt -> {
                if (calls.incrementAndGet() == 1) return first;
                if (mode.equals("read")) throw new IllegalStateException(canary);
                return mode.equals("eof") ? null : second;
            });
            assertThatThrownBy(() -> input.readAndConfirm(null)).isInstanceOf(Failure.class)
                    .hasMessage("SECRET_INPUT_INVALID").hasNoCause();
            assertThat(first).containsOnly('\0');
            if (!mode.equals("read") && !mode.equals("eof")) assertThat(second).containsOnly('\0');
        }
    }

    @Test
    void PP1FM04_defaultGuardPreventsDataSourceCreation() {
        var factories = new java.util.concurrent.atomic.AtomicInteger();
        java.util.function.Supplier<DataSource> factory = () -> { factories.incrementAndGet(); return mock(HikariDataSource.class); };
        var dependencies = new IdentityMaintenanceConfiguration.Dependencies(factory, ds -> fail("schema must not run"));
        assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), MaintenanceGuard.defaultDeny(), dependencies))
                .isInstanceOf(Failure.class).hasMessage("HOST_GUARD_NOT_CONFIGURED");
        assertThat(factories).hasValue(0);
    }

    @Test
    void PP1AC02_maintenanceContextContainsOnlyExplicitBeans() throws Exception {
        withEnvironment(() -> {
            var phases = new ArrayList<String>();
            var pool = pool(73, "1790000000.123456");
            var phase = phase(phases);
            var guard = guard(phase);
            var deps = new IdentityMaintenanceConfiguration.Dependencies(() -> { phases.add("pool"); return pool; },
                    ds -> { assertThat(ds).isSameAs(pool); phases.add("validate"); });
            try (var context = IdentityMaintenanceConfiguration.open(options(), guard, deps)) {
                assertThat(phases).containsExactly("pre", "pool", "bind:73:1790000000.123456", "bound", "validate");
                assertThat(context.getBeansOfType(DataSource.class)).hasSize(1).containsValue(pool);
                assertThat(((DataSourceTransactionManager) context.getBean(PlatformTransactionManager.class)).getDataSource()).isSameAs(pool);
                assertThat(context.getBean(JdbcIdentityStore.class)).isNotNull();
                assertThat(context.getBean(TransactionRunner.class)).isNotNull();
                assertThat(context.getBean(AuditLog.class)).isNotNull();
                assertThat(context.getBean(ProductionIdentityService.class)).isNotNull();
                assertThat(context.getBean(IdentityProperties.class).isSeedEnabled()).isFalse();
                assertThat(context.getBean(IdentityProperties.class).getSeedPassword()).isEmpty();
                var businessBeans = Arrays.stream(context.getBeanDefinitionNames()).filter(name -> !name.startsWith("org.springframework.")).toList();
                assertThat(businessBeans).containsExactlyInAnyOrder("dataSource", "platformTransactionManager", "transactionTemplate",
                        "jdbcIdentityStore", "transactionRunner", "identityProperties", "passwordHasher", "objectMapper",
                        "auditLog", "maintenanceGuard", "productionIdentityService");
                assertThat(context.getBeansOfType(org.springframework.context.ApplicationListener.class)).isEmpty();
            }
            verify(pool).setMaximumPoolSize(1); verify(pool).setMinimumIdle(0);
            verify(pool).addDataSourceProperty("ApplicationName", OP); verify(pool).close();
        });
    }

    @Test
    void PP1FM04_invalidBackendAndSchemaFailureClosePool() throws Exception {
        withEnvironment(() -> {
            for (String epoch : new String[]{null, "0.0", "1790000000", "1790000000.123456"}) {
                var pool = pool(epoch == null ? 0 : 73, epoch);
                var events = new ArrayList<String>();
                assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), guard(phase(events)),
                        new IdentityMaintenanceConfiguration.Dependencies(() -> pool, ds -> { throw new IllegalStateException("private-jdbc-canary"); })))
                        .isInstanceOf(RuntimeException.class);
                verify(pool, atLeastOnce()).close();
                if (epoch == null || !epoch.contains(".") || epoch.startsWith("0")) assertThat(events).containsExactly("pre");
            }
        });
    }

    @Test
    void PP1FM04_everyRequiredProductionSettingRejectsBeforePool() throws Exception {
        withEnvironment(() -> {
            var required = List.of("CMS_RUNTIME_PRODUCTION_REQUIRED", "CMS_SITE_DOMAIN", "CMS_API_ORIGIN", "CMS_CORS_ORIGINS",
                    "CMS_SURFACE_ORIGINS", "CMS_IDENTITY_SEED_ENABLED", "CMS_IDENTITY_COOKIE_SECURE", "CMS_MEDIA_ROOT",
                    "SPRING_DATASOURCE_URL", "SPRING_DATASOURCE_USERNAME", "SPRING_DATASOURCE_PASSWORD");
            for (String key : required) {
                String old = System.getProperty(key);
                try {
                    System.setProperty(key, "");
                    var factories = new java.util.concurrent.atomic.AtomicInteger();
                    java.util.function.Supplier<DataSource> factory = () -> { factories.incrementAndGet(); return mock(HikariDataSource.class); };
                    assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), guard(phase(new ArrayList<>())),
                            new IdentityMaintenanceConfiguration.Dependencies(factory, ds -> fail("no validation"))))
                            .isInstanceOf(Failure.class).hasMessage("INPUT_INVALID");
                    assertThat(factories).hasValue(0);
                } finally { System.setProperty(key, old); }
            }
        });
    }

    @Test
    void PP1FM04_boundGuardRejectionNeverValidatesOrBuildsContext() throws Exception {
        withEnvironment(() -> {
            for (String scenario : List.of("zero", "replacement", "extra-same-name")) {
                var phase = mock(MaintenanceGuard.ConnectionPhase.class);
                doThrow(new Failure(FailureCode.QUIESCENCE_NOT_PROVEN)).when(phase).assertBound();
                var pool = pool(73, "1790000000.123456");
                var validations = new java.util.concurrent.atomic.AtomicInteger();
                assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), guard(phase),
                        new IdentityMaintenanceConfiguration.Dependencies(() -> pool, ds -> validations.incrementAndGet())))
                        .as("fake adapter denial: %s", scenario).hasMessage("QUIESCENCE_NOT_PROVEN");
                verify(phase).bindBackend(73, "1790000000.123456");
                assertThat(validations).hasValue(0);
                verify(pool).close();
            }
        });
    }

    @Test
    void PP1FM04_missingBackendAndFatalGuardFaultClosePool() throws Exception {
        withEnvironment(() -> {
            for (boolean missing : new boolean[]{true, false}) {
                var pool = pool(73, "1790000000.123456");
                var phase = mock(MaintenanceGuard.ConnectionPhase.class);
                if (missing) when(pool.getConnection().createStatement().executeQuery(anyString()).next()).thenReturn(false);
                else doThrow(new AssertionError("private-fault-canary")).when(phase).assertBound();
                assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), guard(phase),
                        new IdentityMaintenanceConfiguration.Dependencies(() -> pool, ds -> fail("no schema validation"))))
                        .isInstanceOf(Failure.class).hasMessage(missing ? "QUIESCENCE_NOT_PROVEN" : "MAINTENANCE_INTERNAL_ERROR").hasNoCause();
                verify(pool, atLeastOnce()).close();
            }
        });
    }

    @Test
    void PP1FM04_unresolvedConfigPlaceholderIsFixedInputFailure() throws Exception {
        withEnvironment(() -> {
            String old = System.getProperty("CMS_SITE_DOMAIN");
            try {
                System.setProperty("CMS_SITE_DOMAIN", "${private-unresolved-config-canary}");
                assertThatThrownBy(() -> IdentityMaintenanceConfiguration.open(options(), guard(phase(new ArrayList<>())),
                        new IdentityMaintenanceConfiguration.Dependencies(() -> { fail("no pool"); return null; }, ds -> fail("no schema"))))
                        .isInstanceOf(Failure.class).hasMessage("INPUT_INVALID").hasNoCause();
            } finally { System.setProperty("CMS_SITE_DOMAIN", old); }
        });
    }

    private static Options options() { return new Options(Operation.FRESH_INIT, "pp1.root", "PP1 root", null, "test", UUID.fromString(OP), false); }

    @Test
    void PP1FM04_contextAndGuardFaultsClearSecretAndSuppressDetails() {
        for (String fault : List.of("guard", "database", "hash", "error")) {
            char[] first = UUID.randomUUID().toString().toCharArray(), second = first.clone();
            String canary = new String(first);
            var calls = new java.util.concurrent.atomic.AtomicInteger();
            var input = new ConsoleSecretInput(prompt -> calls.incrementAndGet() == 1 ? first : second);
            var out = new ByteArrayOutputStream(); var err = new ByteArrayOutputStream();
            var context = new AnnotationConfigApplicationContext();
            var service = mock(ProductionIdentityService.class);
            context.registerBean(ProductionIdentityService.class, () -> service);
            context.refresh();
            when(service.freshInit(any(), any())).thenThrow(new IllegalStateException(canary + " encoded-hash-canary"));
            int exit;
            try {
                exit = run(fresh(), input, opts -> {
                    if (fault.equals("guard")) throw new Failure(FailureCode.HOST_GUARD_NOT_CONFIGURED);
                    if (fault.equals("database")) throw new IllegalStateException("private-jdbc-canary");
                    if (fault.equals("error")) throw new AssertionError(canary);
                    return context;
                }, new PrintStream(out), new PrintStream(err));
                if (fault.equals("hash")) assertThat(context.isActive()).isFalse();
            } finally { context.close(); }
            assertThat(exit).isEqualTo(fault.equals("guard") ? 6 : 5);
            assertThat(first).containsOnly('\0'); assertThat(second).containsOnly('\0');
            assertThat(out.toString()).isEmpty();
            assertThat(err.toString()).contains(fault.equals("guard") ? "HOST_GUARD_NOT_CONFIGURED" : "MAINTENANCE_INTERNAL_ERROR")
                    .doesNotContain(canary, "private-jdbc-canary", "encoded-hash-canary", "Exception");
        }
    }

    @Test
    void PP1FM04_recoveryDispatchClearsSecretAndReturnsOnlyFixedErrors() {
        for (var code : List.of(FailureCode.SECRET_INPUT_INVALID, FailureCode.TARGET_NOT_ADMIN, FailureCode.MAINTENANCE_INTERNAL_ERROR)) {
            char[] first = UUID.randomUUID().toString().toCharArray(), second = first.clone(); String canary = new String(first);
            var reads = new java.util.concurrent.atomic.AtomicInteger();
            var input = new ConsoleSecretInput(prompt -> reads.incrementAndGet() == 1 ? first : second);
            var service = mock(ProductionIdentityService.class); when(service.recoverAdmin(any(), any())).thenThrow(new Failure(code));
            var context = mock(org.springframework.context.ConfigurableApplicationContext.class);
            when(context.getBean(ProductionIdentityService.class)).thenReturn(service);
            var out = new ByteArrayOutputStream(); var err = new ByteArrayOutputStream();
            var args = new String[]{"recover-admin", "--principal-id", OP, "--target-id", "test", "--operation-id", OP, "--confirm", "RECOVER_ADMIN"};
            assertThat(run(args, input, opts -> context, new PrintStream(out), new PrintStream(err))).isEqualTo(code.exitCode());
            verify(service).recoverAdmin(any(), any()); verify(service, never()).freshInit(any(), any()); verify(context).close();
            assertThat(first).containsOnly('\0'); assertThat(second).containsOnly('\0'); assertThat(out.toString()).isEmpty();
            assertThat(err.toString()).contains(code.name(), OP).doesNotContain(canary, "password", "hash", "username", "Exception");
        }
    }

    @Test
    void PP1FM04_recoverParserAcceptsOnlyItsOwnFlagsAndCanonicalIds() {
        String[] args = {"recover-admin", "--principal-id", OP, "--target-id", "test", "--operation-id", OP,
                "--confirm", "RECOVER_ADMIN", "--reenable"};
        var parsed = parse(args);
        assertThat(parsed.operation()).isEqualTo(Operation.RECOVER_ADMIN);
        assertThat(parsed.principalId()).isEqualTo(UUID.fromString(OP));
        assertThat(parsed.username()).isNull(); assertThat(parsed.reenable()).isTrue();
        args[2] = OP.toUpperCase(java.util.Locale.ROOT).replace("0001", "000A");
        assertThatThrownBy(() -> parse(args)).hasMessage("INPUT_INVALID");
        var incompatible = new ArrayList<>(List.of(args));
        incompatible.set(2, OP); incompatible.addAll(List.of("--username", "pp1.root"));
        assertThatThrownBy(() -> parse(incompatible.toArray(String[]::new))).hasMessage("INPUT_INVALID");
    }

    @Test
    void PP1FM04_resultIsNonSecretAndKnownCommitSurvivesCloseFault() throws Exception {
        for (boolean closeFault : new boolean[]{false, true}) {
            char[] first = UUID.randomUUID().toString().toCharArray(), second = first.clone();
            String canary = new String(first);
            var calls = new java.util.concurrent.atomic.AtomicInteger();
            var input = new ConsoleSecretInput(prompt -> calls.incrementAndGet() == 1 ? first : second);
            var context = mock(org.springframework.context.ConfigurableApplicationContext.class);
            var service = mock(ProductionIdentityService.class);
            var result = new Result(UUID.fromString(OP), Operation.FRESH_INIT, UUID.randomUUID(),
                    java.time.Instant.parse("2026-10-01T00:00:00Z"), "sha256:fixture", "test");
            when(context.getBean(ProductionIdentityService.class)).thenReturn(service);
            when(service.freshInit(any(), any())).thenReturn(result);
            if (closeFault) doThrow(new Failure(FailureCode.QUIESCENCE_NOT_PROVEN)).when(context).close();
            var out = new ByteArrayOutputStream(); var err = new ByteArrayOutputStream();
            assertThat(run(fresh(), input, opts -> context, new PrintStream(out), new PrintStream(err))).isEqualTo(closeFault ? 5 : 0);
            verify(context).close();
            assertThat(first).containsOnly('\0'); assertThat(second).containsOnly('\0');
            assertThat(out.toString() + err).doesNotContain(canary, "password", "hash", "pp1.root", "PP1 root");
            var json = new com.fasterxml.jackson.databind.ObjectMapper().readTree(closeFault ? err.toString() : out.toString());
            if (closeFault) {
                assertThat(out.toString()).isEmpty();
                assertThat(json.get("code").asText()).isEqualTo("COMMITTED_HOST_RESTORE_FAILED");
                assertThat(json.get("operationId").asText()).isEqualTo(OP);
            } else {
                assertThat(err.toString()).isEmpty();
                assertThat(json.size()).isEqualTo(6);
                assertThat(json.get("completedAt").asText()).isEqualTo("2026-10-01T00:00:00Z");
                assertThat(json.get("principalId").asText()).isEqualTo(result.principalId().toString());
            }
        }
    }

    @Test
    void PP1FM04_trueEntryRejectsWrongPositionAndNoTtyWithoutFrameworkLogs() throws Exception {
        String classpath = System.getProperty("java.class.path");
        for (boolean wrongPosition : new boolean[]{false, true}) {
            var command = new ArrayList<>(List.of(java.nio.file.Path.of(System.getProperty("java.home"), "bin", "java").toString(),
                    "-cp", classpath, "com.fallrising.cms.CmsApiApplication"));
            command.addAll(wrongPosition ? List.of("--server.port=0", "maintenance") : List.of("maintenance"));
            if (!wrongPosition) command.addAll(List.of(fresh()));
            var builder = new ProcessBuilder(command).redirectErrorStream(true);
            builder.environment().put("SPRING_DATASOURCE_URL", "jdbc:postgresql://private-jdbc-canary/cms");
            var child = builder.start();
            try {
                assertThat(child.waitFor(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                assertThat(child.exitValue()).isEqualTo(2);
                String output = new String(child.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
                assertThat(output.lines()).hasSize(1);
                assertThat(output).contains(wrongPosition ? "INPUT_INVALID" : "SECRET_INPUT_INVALID")
                        .doesNotContain("private-jdbc-canary", "Spring", "Hikari", "Flyway", "Exception", "pp1.root", "PP1 root");
            } finally { if (child.isAlive()) child.destroyForcibly(); }
        }
    }
    private static MaintenanceGuard guard(MaintenanceGuard.ConnectionPhase phase) {
        var guard = mock(MaintenanceGuard.class); when(guard.connectionPhase()).thenReturn(phase); return guard;
    }
    private static MaintenanceGuard.ConnectionPhase phase(List<String> events) {
        return new MaintenanceGuard.ConnectionPhase() {
            public void assertPreConnection() { events.add("pre"); }
            public void bindBackend(int pid, String epoch) { events.add("bind:" + pid + ":" + epoch); }
            public void assertBound() { events.add("bound"); }
        };
    }
    private static HikariDataSource pool(int pid, String epoch) throws Exception {
        var pool = mock(HikariDataSource.class); var connection = mock(Connection.class);
        var statement = mock(Statement.class); var result = mock(ResultSet.class);
        when(pool.getConnection()).thenReturn(connection); when(connection.createStatement()).thenReturn(statement);
        when(statement.executeQuery(anyString())).thenReturn(result); when(result.next()).thenReturn(true, false);
        when(result.getInt("pid")).thenReturn(pid); when(result.getString("backend_start_epoch")).thenReturn(epoch);
        return pool;
    }
    private static void withEnvironment(ThrowingRunnable work) throws Exception {
        var values = new HashMap<>(Map.of("CMS_SITE_DOMAIN", "cms.test", "CMS_API_ORIGIN", "https://api.cms.test:8443",
                "CMS_CORS_ORIGINS", "https://front.cms.test:8443,https://back.cms.test:8443,https://admin.cms.test:8443",
                "CMS_SURFACE_ORIGINS", "https://front.cms.test:8443:front,https://back.cms.test:8443:back,https://admin.cms.test:8443:admin",
                "CMS_IDENTITY_SEED_ENABLED", "false", "CMS_IDENTITY_COOKIE_SECURE", "true", "CMS_MEDIA_ROOT", "/data/media",
                "SPRING_DATASOURCE_URL", "jdbc:postgresql://172.20.0.2:5432/cms", "SPRING_DATASOURCE_USERNAME", "cms_local",
                "SPRING_DATASOURCE_PASSWORD", UUID.randomUUID().toString()));
        values.put("CMS_RUNTIME_PRODUCTION_REQUIRED", "true");
        var previous = new HashMap<String, String>(); values.forEach((key, value) -> previous.put(key, System.getProperty(key)));
        try { values.forEach(System::setProperty); work.run(); }
        finally { previous.forEach((key, value) -> { if (value == null) System.clearProperty(key); else System.setProperty(key, value); }); }
    }
    private interface ThrowingRunnable { void run() throws Exception; }
    private static final class LocalFixture implements AutoCloseable {
        final java.nio.file.Path cwd, lease, node, script;
        final Map<String,String> env = new HashMap<>();
        final Map<String,Object> metadata = new HashMap<>();
        final List<List<String>> calls = new ArrayList<>();
        final String runId = "a".repeat(32), target = "pp1-local:"+runId, hash = "b".repeat(64);
        LocalFixture() throws Exception {
            cwd = java.nio.file.Files.createTempDirectory("pp1-attachment-");
            lease = cwd.resolve("local/pp1/"+runId+"/maintenance/lease.json");
            java.nio.file.Files.createDirectories(lease.getParent().resolve("operations"));
            java.nio.file.Files.createDirectory(lease.getParent().resolve("operation.lock"));
            for (var path : List.of(cwd,lease.getParent(),lease.getParent().getParent(),lease.getParent().getParent().getParent(),lease.getParent().getParent().getParent().getParent(),lease.getParent().resolve("operations"),lease.getParent().resolve("operation.lock")))
                java.nio.file.Files.setPosixFilePermissions(path,java.nio.file.attribute.PosixFilePermissions.fromString("rwx------"));
            node=cwd.resolve("node");script=cwd.resolve("scripts/local/maintenance-guard.mjs");java.nio.file.Files.createDirectories(script.getParent());
            java.nio.file.Files.writeString(node,"node fixture");java.nio.file.Files.writeString(script,"guard fixture");
            env.put("CMS_MAINTENANCE_RUN_ID",runId);env.put("CMS_MAINTENANCE_NODE_BINARY",node.toString());
            env.put("CMS_MAINTENANCE_NODE_SHA256",localDigest(node));env.put("CMS_MAINTENANCE_GUARD_SHA256",localDigest(script));
            env.put("SPRING_DATASOURCE_URL","jdbc:postgresql://172.18.0.2:5432/cms");env.put("SPRING_DATASOURCE_USERNAME","cms_local");
            metadata.putAll(Map.of("version",1,"runId",runId,"targetId",target,"project","cms-pp1-local-"+runId,"sourceCommit","c".repeat(40),"apiBuild",Map.of("sourceCommit","c".repeat(40),"jarSha256",hash,"baseImage","sha256:"+hash)));
            metadata.putAll(Map.of("images",Map.of("api","sha256:"+hash,"node","sha256:"+hash,"postgres","sha256:"+hash),"containerIds",Map.of("postgres",hash,"cms-api",hash,"ingress",hash),"networkIds",Map.of("web",hash,"data",hash),"volumeNames",Map.of("db-data","cms-pp1-local-"+runId+"_db-data","media-data","cms-pp1-local-"+runId+"_media-data")));
            metadata.putAll(Map.of("databaseOid",42,"ingressScriptSha256",hash,"nodeBinarySha256",localDigest(node),"mediaProbeSha256",hash,"connection",Map.of("jdbcUrl",env.get("SPRING_DATASOURCE_URL"),"dataGateway","172.18.0.1"),"operationId",OP,"operation","FRESH_INIT","releaseId","sha256:"+hash,"phase","PRE_CONNECTION","createdAt","2026-10-09T00:00:00.000Z"));
            metadata.put("boundBackend",null);save();
        }
        void save() throws Exception {
            java.nio.file.Files.writeString(lease,new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(metadata));
            java.nio.file.Files.setPosixFilePermissions(lease,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
            var target=new HashMap<>(metadata);for(String key:List.of("connection","operationId","operation","releaseId","phase","boundBackend","createdAt"))target.remove(key);
            var journal=new HashMap<String,Object>();for(String key:List.of("operationId","operation","targetId","releaseId","phase"))journal.put(key,metadata.get(key));journal.put("at","2026-10-09T00:00:00.000Z");journal.put("failureCode",null);
            for(var pair:Map.of(lease.resolveSibling("target.json"),target,lease.getParent().resolve("operations/"+OP+".json"),journal).entrySet()){
                java.nio.file.Files.writeString(pair.getKey(),new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(pair.getValue()));java.nio.file.Files.setPosixFilePermissions(pair.getKey(),java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
            }
        }
        LocalMaintenanceGuard guard() { return new LocalMaintenanceGuard(lease,node,script,target,UUID.fromString(OP),env,(args,path)->{assertThat(path).isEqualTo(cwd);calls.add(List.copyOf(args));return 0;}); }
        void bound() throws Exception { metadata.put("phase","BOUND");metadata.put("boundBackend",Map.of("pid",123,"backendStartEpoch","1720000000.123456","db","cms","role","cms_local","clientAddr","172.18.0.1","applicationName",OP));save(); }
        @Override public void close() throws Exception { try(var stream=java.nio.file.Files.walk(cwd)){for(var path:stream.sorted(java.util.Comparator.reverseOrder()).toList())java.nio.file.Files.delete(path);} }
    }
    private static String localDigest(java.nio.file.Path path) throws Exception {
        return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(path)));
    }
    @Test void PP1FM04_localAttachmentValidPreAndBoundUseFixedHelpers() throws Exception {
        try(var f=new LocalFixture()) {
            var guard=f.guard();guard.assertPreConnection();assertThat(f.calls.getFirst()).containsExactly(f.node.toString(),f.script.toString(),"assert","--run-id",f.runId,"--operation-id",OP,"--phase","pre-connection");
            guard.bindBackend(123,"1720000000.123456");assertThat(f.calls.getLast()).containsSubsequence("bind-backend","--run-id",f.runId,"--operation-id",OP,"--pid","123","--backend-start-epoch","1720000000.123456");
            f.bound();guard.assertBound();try(var lease=guard.acquire(f.target,UUID.fromString(OP),Operation.FRESH_INIT)){assertThat(lease.releaseId()).isEqualTo("sha256:"+f.hash);assertThat(lease.backupId()).isNull();lease.assertQuiesced();}
        }
    }
    @Test void PP1FM04_localAttachmentRejectsMetadataBeforeHelper() throws Exception {
        for(String mode:List.of("extra","mode","hash","target","phase","link","destination"))try(var f=new LocalFixture()) {
            var guard=f.guard();
            switch(mode){case "extra" -> f.metadata.put("unknown",true);case "hash" -> f.metadata.put("nodeBinarySha256","0".repeat(64));case "target" -> f.metadata.put("targetId","other");case "phase" -> f.metadata.put("phase","COMPLETE");case "destination" -> f.metadata.put("connection",Map.of("jdbcUrl","jdbc:postgresql://172.18.0.3:5432/cms","dataGateway","172.18.0.1"));default -> {}}
            f.save();if(mode.equals("mode"))java.nio.file.Files.setPosixFilePermissions(f.lease,java.nio.file.attribute.PosixFilePermissions.fromString("rw-r--r--"));if(mode.equals("link"))java.nio.file.Files.createLink(f.lease.resolveSibling("alias"),f.lease);
            assertThatThrownBy(guard::assertPreConnection).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).isEmpty();
        }
    }
    @Test void PP1FM04_localProductionSelectorRejectsPartialConfiguration() throws Exception {
        try(var f=new LocalFixture()) {
            var options=new Options(Operation.FRESH_INIT,"pp1.root","PP1 root",null,f.target,UUID.fromString(OP),false);
            assertThatThrownBy(()->LocalMaintenanceGuard.fromEnvironment(options,Map.of("CMS_MAINTENANCE_RUN_ID",f.runId),f.cwd)).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");
        }
    }

    @Test void PP1FM04_localAttachmentEveryBackendFieldAndGenerationStayPinned() throws Exception {
        for(String field:List.of("pid","backendStartEpoch","db","role","clientAddr","applicationName","extra"))try(var f=new LocalFixture()) {
            f.bound();var guard=f.guard();guard.assertBound();int before=f.calls.size();
            var backend=new HashMap<String,Object>((Map<String,Object>)f.metadata.get("boundBackend"));
            backend.put(field,field.equals("pid")?124:field.equals("backendStartEpoch")?"1720000000.123457":field.equals("clientAddr")?"172.18.0.9":"other");f.metadata.put("boundBackend",backend);f.save();
            assertThatThrownBy(guard::assertBound).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).hasSize(before);
        }
        try(var f=new LocalFixture()) {
            var guard=f.guard();guard.assertPreConnection();int before=f.calls.size();f.metadata.put("mediaProbeSha256","d".repeat(64));f.save();
            assertThatThrownBy(guard::assertPreConnection).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).hasSize(before);
        }
    }
    @Test void PP1FM04_localAttachmentHelperFailureAndInvalidBindingNeverRebind() throws Exception {
        try(var f=new LocalFixture()) {
            var guard=new LocalMaintenanceGuard(f.lease,f.node,f.script,f.target,UUID.fromString(OP),f.env,(args,cwd)->6);
            assertThatThrownBy(guard::assertPreConnection).hasMessage("QUIESCENCE_NOT_PROVEN");
            guard=f.guard();final var valid=guard;
            assertThatThrownBy(()->valid.bindBackend(0,"1720000000.123456")).hasMessage("QUIESCENCE_NOT_PROVEN");
            assertThatThrownBy(()->valid.bindBackend(123,"1e9")).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).isEmpty();
            f.bound();assertThatThrownBy(()->valid.bindBackend(124,"1720000000.123456")).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).isEmpty();
        }
    }
    @Test void PP1FM04_localAttachmentSymlinkCorruptJournalAndNestedKeysFailClosed() throws Exception {
        for(String mode:List.of("symlink","journal","nested","duplicate","trailing","largeversion"))try(var f=new LocalFixture()) {
            var guard=f.guard();
            switch(mode) {
                case "symlink" -> {var real=f.lease.resolveSibling("real.json");java.nio.file.Files.move(f.lease,real);java.nio.file.Files.createSymbolicLink(f.lease,real);}
                case "journal" -> java.nio.file.Files.writeString(f.lease.getParent().resolve("operations/"+OP+".json"),"{}");
                case "nested" -> {f.metadata.put("images",Map.of("api","sha256:"+f.hash,"node","sha256:"+f.hash,"postgres","sha256:"+f.hash,"extra","x"));f.save();}
                case "duplicate" -> java.nio.file.Files.writeString(f.lease,java.nio.file.Files.readString(f.lease).replaceFirst("\\{","{\"version\":1,"));
                case "trailing" -> java.nio.file.Files.writeString(f.lease,java.nio.file.Files.readString(f.lease)+" {}");
                case "largeversion" -> {f.metadata.put("version",4294967297L);f.save();}
                default -> throw new AssertionError();
            }
            assertThatThrownBy(guard::assertPreConnection).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(f.calls).isEmpty();
        }
    }

    @Test void PP1FM04_localProductionSelectorUsesFixedCompleteAttachment() throws Exception {
        try(var f=new LocalFixture()) {
            var options=new Options(Operation.FRESH_INIT,"pp1.root","PP1 root",null,f.target,UUID.fromString(OP),false);
            assertThat(LocalMaintenanceGuard.fromEnvironment(options,f.env,f.cwd)).isInstanceOf(LocalMaintenanceGuard.class);
            assertThatThrownBy(()->LocalMaintenanceGuard.fromEnvironment(options,f.env,f.cwd.resolve("other"))).hasMessage("QUIESCENCE_NOT_PROVEN");
            assertThatThrownBy(()->LocalMaintenanceGuard.fromEnvironment(options,Map.of(),f.cwd).connectionPhase()).hasMessage("HOST_GUARD_NOT_CONFIGURED");
        }
    }
    @Test void PP1FM04_localActualDestinationPropertyDriftRejectsBeforeFactory() throws Exception {
        for(String key:List.of("SPRING_DATASOURCE_URL","SPRING_DATASOURCE_USERNAME"))try(var f=new LocalFixture()) {
            withEnvironment(()->{
                System.setProperty("SPRING_DATASOURCE_URL",f.env.get("SPRING_DATASOURCE_URL"));
                System.setProperty(key,key.endsWith("URL")?"jdbc:postgresql://172.18.0.9:5432/cms":"other_user");
                var factories=new java.util.concurrent.atomic.AtomicInteger();
                assertThatThrownBy(()->IdentityMaintenanceConfiguration.open(new Options(Operation.FRESH_INIT,"pp1.root","PP1 root",null,f.target,UUID.fromString(OP),false),f.guard(),
                    new IdentityMaintenanceConfiguration.Dependencies(()->{factories.incrementAndGet();throw new AssertionError("DS_MUST_NOT_OPEN");},ds->{}))).isInstanceOf(Failure.class).hasMessage("QUIESCENCE_NOT_PROVEN");
                assertThat(factories.get()).isZero();
            });
        }
    }
    @Test void PP1FM04_localReceiptHasExactDurableWireAndNeverOverwrites() throws Exception {
        try(var f=new LocalFixture()) {
            f.bound();var lease=f.guard().acquire(f.target,UUID.fromString(OP),Operation.FRESH_INIT);
            var result=new Result(UUID.fromString(OP),Operation.FRESH_INIT,UUID.fromString(OP),java.time.Instant.parse("2026-10-09T00:00:00Z"),"sha256:"+f.hash,f.target);
            lease.recordCommitted(result);var path=f.lease.getParent().resolve("operations/"+OP+".result.json");
            String original=java.nio.file.Files.readString(path);var json=new com.fasterxml.jackson.databind.ObjectMapper().readTree(original);
            assertThat(json.size()).isEqualTo(6);assertThat(json.get("completedAt").asText()).isEqualTo("2026-10-09T00:00:00Z");assertThat(json.get("operationId").asText()).isEqualTo(OP);
            assertThat(original).endsWith("\n");assertThat(java.nio.file.Files.getPosixFilePermissions(path)).isEqualTo(java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));
            assertThatThrownBy(()->lease.recordCommitted(result)).hasMessage("COMMITTED_HOST_RESTORE_FAILED");assertThat(java.nio.file.Files.readString(path)).isEqualTo(original);
            lease.close();assertThatThrownBy(lease::assertQuiesced).hasMessage("QUIESCENCE_NOT_PROVEN");assertThat(java.nio.file.Files.isDirectory(f.lease.getParent().resolve("operation.lock"))).isTrue();
        }
    }
    @Test void PP1FM04_localReceiptRejectsEveryMismatchedOrMissingResultField() throws Exception {
        for(String field:List.of("operationId","operation","principalId","completedAt","releaseId","targetId","wideTime"))try(var f=new LocalFixture()) {
            f.bound();var lease=f.guard().acquire(f.target,UUID.fromString(OP),Operation.FRESH_INIT);
            var result=new Result(field.equals("operationId")?UUID.randomUUID():UUID.fromString(OP),field.equals("operation")?Operation.RECOVER_ADMIN:Operation.FRESH_INIT,
                    field.equals("principalId")?null:UUID.fromString(OP),field.equals("completedAt")?null:field.equals("wideTime")?java.time.Instant.parse("+10000-01-01T00:00:00Z"):java.time.Instant.now(),
                    field.equals("releaseId")?"sha256:"+"0".repeat(64):"sha256:"+f.hash,field.equals("targetId")?"wrong":f.target);
            assertThatThrownBy(()->lease.recordCommitted(result)).hasMessage("COMMITTED_HOST_RESTORE_FAILED");
            assertThat(java.nio.file.Files.exists(f.lease.getParent().resolve("operations/"+OP+".result.json"))).isFalse();
            assertThat(java.nio.file.Files.isDirectory(f.lease.getParent().resolve("operation.lock"))).isTrue();
        }
    }
    @Test void PP1FM04_localInvalidResultAndPartialFileKeepLockWithoutOverwrite() throws Exception {
        for(String mode:List.of("invalid","partial","close"))try(var f=new LocalFixture()) {
            f.bound();final var result=new Result(UUID.fromString(OP),Operation.FRESH_INIT,UUID.fromString(OP),java.time.Instant.now(),"sha256:"+f.hash,f.target);
            var lease=f.guard().acquire(f.target,UUID.fromString(OP),Operation.FRESH_INIT);var path=f.lease.getParent().resolve("operations/"+OP+".result.json");
            if(mode.equals("invalid"))assertThatThrownBy(()->lease.recordCommitted(new Result(result.operationId(),result.operation(),result.principalId(),result.completedAt(),result.releaseId(),"wrong"))).hasMessage("COMMITTED_HOST_RESTORE_FAILED");
            if(mode.equals("partial")){java.nio.file.Files.writeString(path,"{",java.nio.file.StandardOpenOption.CREATE_NEW);java.nio.file.Files.setPosixFilePermissions(path,java.nio.file.attribute.PosixFilePermissions.fromString("rw-------"));assertThatThrownBy(()->lease.recordCommitted(result)).hasMessage("COMMITTED_HOST_RESTORE_FAILED");assertThat(java.nio.file.Files.readString(path)).isEqualTo("{");}
            if(mode.equals("close")){lease.recordCommitted(result);f.metadata.put("phase","FAILED_OR_UNKNOWN");f.save();assertThatThrownBy(lease::close).hasMessage("QUIESCENCE_NOT_PROVEN");}
            assertThat(java.nio.file.Files.isDirectory(f.lease.getParent().resolve("operation.lock"))).isTrue();
        }
    }

}
