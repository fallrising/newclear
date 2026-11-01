package com.fallrising.cms.identity.maintenance;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.ConfigurableApplicationContext;

import java.io.PrintStream;
import java.time.Instant;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.HashMap;
import java.util.Set;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Function;

public final class IdentityMaintenanceCommand {
    private IdentityMaintenanceCommand() {}

    public enum Operation { FRESH_INIT, RECOVER_ADMIN }
    public record Options(Operation operation, String username, String displayName, UUID principalId,
                          String targetId, UUID operationId, boolean reenable) {}
    public record Result(UUID operationId, Operation operation, UUID principalId,
                         Instant completedAt, String releaseId, String targetId) {}
    public enum FailureCode {
        INPUT_INVALID(2), SECRET_INPUT_INVALID(2), NOT_FRESH(3), TARGET_NOT_ADMIN(3), TARGET_DISABLED(3),
        ADMIN_GRANTS_DAMAGED(3), DUPLICATE_OPERATION(3), MAINTENANCE_BUSY(4), MAINTENANCE_INTERNAL_ERROR(5),
        COMMITTED_HOST_RESTORE_FAILED(5), HOST_GUARD_NOT_CONFIGURED(6), QUIESCENCE_NOT_PROVEN(6),
        RECOVERY_BACKUP_REQUIRED(6);
        private final int exitCode;
        FailureCode(int exitCode) { this.exitCode = exitCode; }
        public int exitCode() { return exitCode; }
    }
    public static final class Failure extends RuntimeException {
        private final FailureCode code;
        public Failure(FailureCode code) { super(code.name()); this.code = code; }
        public FailureCode code() { return code; }
    }

    public static Options parse(String[] args) {
        try {
            if (args.length == 0) throw new IllegalArgumentException();
            Operation operation = switch (args[0]) {
                case "fresh-init" -> Operation.FRESH_INIT;
                case "recover-admin" -> Operation.RECOVER_ADMIN;
                default -> throw new IllegalArgumentException();
            };
            var allowed = operation == Operation.FRESH_INIT
                    ? Set.of("--username", "--display-name", "--target-id", "--operation-id", "--confirm")
                    : Set.of("--principal-id", "--target-id", "--operation-id", "--confirm", "--reenable");
            var values = new HashMap<String, String>();
            for (int i = 1; i < args.length; i++) {
                String flag = args[i];
                if (!allowed.contains(flag) || values.containsKey(flag)) throw new IllegalArgumentException();
                String value = "true";
                if (!flag.equals("--reenable")) {
                    if (++i == args.length || args[i].startsWith("--")) throw new IllegalArgumentException();
                    value = args[i];
                    if (value.isBlank()) throw new IllegalArgumentException();
                }
                values.put(flag, value);
            }
            for (String flag : allowed) if (!flag.equals("--reenable") && !values.containsKey(flag)) throw new IllegalArgumentException();
            if (!operation.name().equals(values.get("--confirm"))) throw new IllegalArgumentException();
            UUID operationId = canonicalUuid(values.get("--operation-id"));
            String username = null, displayName = null;
            UUID principalId = null;
            if (operation == Operation.FRESH_INIT) {
                username = values.get("--username").toLowerCase(Locale.ROOT);
                displayName = values.get("--display-name");
                if (!username.matches("^[a-z0-9._-]{3,32}$") || username.startsWith("seed-")
                        || displayName.codePointCount(0, displayName.length()) > 80) throw new IllegalArgumentException();
            } else principalId = canonicalUuid(values.get("--principal-id"));
            return new Options(operation, username, displayName, principalId, values.get("--target-id"), operationId,
                    values.containsKey("--reenable"));
        } catch (RuntimeException ignored) {
            throw new Failure(FailureCode.INPUT_INVALID);
        }
    }

    private static UUID canonicalUuid(String input) {
        UUID id = UUID.fromString(input);
        if (!id.toString().equals(input)) throw new IllegalArgumentException();
        return id;
    }

    public static int run(String[] args) {
        return run(args, new ConsoleSecretInput(), options ->
                IdentityMaintenanceConfiguration.open(options, LocalMaintenanceGuard.fromEnvironment(options, System.getenv(), java.nio.file.Path.of("").toAbsolutePath())), System.out, System.err);
    }

    static int run(String[] args, ConsoleSecretInput input, Function<Options, ConfigurableApplicationContext> contexts,
                   PrintStream out, PrintStream err) {
        Options options = null;
        char[] password = null;
        Result result = null;
        try {
            options = parse(args);
            password = input.readAndConfirm(options.username());
            try (var context = contexts.apply(options)) {
                var service = context.getBean(ProductionIdentityService.class);
                result = options.operation() == Operation.FRESH_INIT
                        ? service.freshInit(options, password) : service.recoverAdmin(options, password);
            }
            out.println(new ObjectMapper().writeValueAsString(Map.of("operationId", result.operationId().toString(),
                    "operation", result.operation().name(), "principalId", result.principalId().toString(),
                    "completedAt", result.completedAt().toString(), "releaseId", result.releaseId(),
                    "targetId", result.targetId())));
            return 0;
        } catch (Throwable failure) {
            var code = result != null ? FailureCode.COMMITTED_HOST_RESTORE_FAILED
                    : failure instanceof Failure known ? known.code() : FailureCode.MAINTENANCE_INTERNAL_ERROR;
            var error = new LinkedHashMap<String, Object>();
            error.put("code", code.name());
            error.put("operationId", options == null ? null : options.operationId().toString());
            try { err.println(new ObjectMapper().writeValueAsString(error)); }
            catch (Exception ignored) { err.println("{\"code\":\"MAINTENANCE_INTERNAL_ERROR\",\"operationId\":null}"); }
            return code.exitCode();
        } finally {
            if (password != null) Arrays.fill(password, '\0');
        }
    }
}
