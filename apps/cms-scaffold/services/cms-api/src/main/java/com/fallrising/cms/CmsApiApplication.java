package com.fallrising.cms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.logging.LogLevel;
import com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand;
import java.util.Arrays;
import java.util.function.Consumer;
import java.util.function.ToIntFunction;
import com.fallrising.cms.ops.RecoveryInventoryMain;
import com.fallrising.cms.ops.RestoreSessionRevoker;

@SpringBootApplication
public class CmsApiApplication {

    public static void main(String[] args) {
        Integer exit = dispatch(args, normal -> SpringApplication.run(CmsApiApplication.class, normal),
                maintenance -> {
                    LoggingSystem.get(CmsApiApplication.class.getClassLoader()).setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
                    return IdentityMaintenanceCommand.run(maintenance);
                }, offline -> RecoveryInventoryMain.run(offline, System.getenv(), System.out),
                offline -> RestoreSessionRevoker.run(offline, System.getenv(), System.out));
        if (exit != null) System.exit(exit);
    }

    static Integer dispatch(String[] args, Consumer<String[]> spring, ToIntFunction<String[]> maintenance,
                            ToIntFunction<String[]> inventory, ToIntFunction<String[]> revoke) {
        if (Arrays.asList(args).contains("maintenance")) {
            return maintenance.applyAsInt(args[0].equals("maintenance")
                    ? Arrays.copyOfRange(args, 1, args.length) : new String[0]);
        }
        long tokens = Arrays.stream(args).filter(arg -> arg.equals("ops-inventory")
                || arg.equals("ops-revoke-restored-sessions")).count();
        if (tokens != 0) {
            if (tokens != 1 || args.length != 3 || !args[1].equals("--request")
                    || !args[2].equals("/run/pp1/request.json")) return 2;
            String[] offline = Arrays.copyOfRange(args, 1, args.length);
            if (args[0].equals("ops-inventory")) return inventory.applyAsInt(offline);
            if (args[0].equals("ops-revoke-restored-sessions")) return revoke.applyAsInt(offline);
            return 2;
        }
        spring.accept(args);
        return null;
    }
}
