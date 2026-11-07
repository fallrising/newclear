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

@SpringBootApplication
public class CmsApiApplication {

    public static void main(String[] args) {
        Integer exit = dispatch(args, normal -> SpringApplication.run(CmsApiApplication.class, normal),
                maintenance -> {
                    LoggingSystem.get(CmsApiApplication.class.getClassLoader()).setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
                    return IdentityMaintenanceCommand.run(maintenance);
                }, offline -> RecoveryInventoryMain.run(offline, System.getenv(), System.out));
        if (exit != null) System.exit(exit);
    }

    static Integer dispatch(String[] args, Consumer<String[]> spring, ToIntFunction<String[]> maintenance,
                            ToIntFunction<String[]> inventory) {
        if (Arrays.asList(args).contains("maintenance")) {
            return maintenance.applyAsInt(args[0].equals("maintenance")
                    ? Arrays.copyOfRange(args, 1, args.length) : new String[0]);
        }
        long tokens = Arrays.stream(args).filter(arg -> arg.equals("ops-inventory")
                || arg.equals("ops-revoke-restored-sessions")).count();
        if (tokens != 0) {
            if (tokens != 1 || !args[0].equals("ops-inventory")) return 2;
            return inventory.applyAsInt(Arrays.copyOfRange(args, 1, args.length));
        }
        spring.accept(args);
        return null;
    }
}
