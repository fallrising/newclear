package com.fallrising.cms;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.logging.LoggingSystem;
import org.springframework.boot.logging.LogLevel;
import com.fallrising.cms.identity.maintenance.IdentityMaintenanceCommand;
import java.util.Arrays;

@SpringBootApplication
public class CmsApiApplication {

    public static void main(String[] args) {
        if (Arrays.asList(args).contains("maintenance")) {
            LoggingSystem.get(CmsApiApplication.class.getClassLoader()).setLogLevel(LoggingSystem.ROOT_LOGGER_NAME, LogLevel.OFF);
            int exit = args[0].equals("maintenance")
                    ? IdentityMaintenanceCommand.run(Arrays.copyOfRange(args, 1, args.length))
                    : IdentityMaintenanceCommand.run(new String[0]);
            System.exit(exit);
            return;
        }
        SpringApplication.run(CmsApiApplication.class, args);
    }
}
