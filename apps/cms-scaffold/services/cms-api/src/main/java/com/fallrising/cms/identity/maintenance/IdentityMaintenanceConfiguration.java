package com.fallrising.cms.identity.maintenance;

import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.fallrising.cms.platform.ProductionEnvironmentValidator;
import com.fallrising.cms.platform.TransactionRunner;
import com.fallrising.cms.identity.IdentityProperties;
import com.fallrising.cms.identity.crypto.PasswordHasher;
import com.fallrising.cms.identity.service.AuditLog;
import com.fallrising.cms.identity.store.JdbcIdentityStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariDataSource;
import org.flywaydb.core.Flyway;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import javax.sql.DataSource;
import java.util.function.Supplier;
import java.util.function.Consumer;

public final class IdentityMaintenanceConfiguration {
    private IdentityMaintenanceConfiguration() {}

    public static ConfigurableApplicationContext open(IdentityMaintenanceCommand.Options options, MaintenanceGuard guard) {
        return open(options, guard, null);
    }

    record Dependencies(Supplier<DataSource> dataSourceFactory, Consumer<DataSource> schemaValidator) {}
    static ConfigurableApplicationContext open(IdentityMaintenanceCommand.Options options, MaintenanceGuard guard, Dependencies dependencies) {
        var phase = guard.connectionPhase();
        phase.assertPreConnection();
        var environment = productionEnvironment();
        if (guard instanceof LocalMaintenanceGuard local) local.assertDataSourceDestination(
                environment.getRequiredProperty("spring.datasource.url"), environment.getRequiredProperty("spring.datasource.username"));
        var deps = dependencies == null ? new Dependencies(() -> DataSourceBuilder.create().type(HikariDataSource.class)
                .url(environment.getRequiredProperty("spring.datasource.url"))
                .username(environment.getRequiredProperty("spring.datasource.username"))
                .password(environment.getRequiredProperty("spring.datasource.password")).build(),
                ds -> Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().validate()) : dependencies;
        DataSource source = deps.dataSourceFactory().get();
        if (!(source instanceof HikariDataSource pool)) {
            if (source instanceof AutoCloseable closeable) {
                try { closeable.close(); } catch (Exception ignored) { }
            }
            throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.MAINTENANCE_INTERNAL_ERROR);
        }
        var context = new AnnotationConfigApplicationContext();
        try {
            pool.setMaximumPoolSize(1);
            pool.setMinimumIdle(0);
            pool.addDataSourceProperty("ApplicationName", options.operationId().toString());
            try (var connection = pool.getConnection(); var statement = connection.createStatement();
                 var result = statement.executeQuery("SELECT pid, extract(epoch FROM backend_start)::text AS backend_start_epoch "
                         + "FROM pg_stat_activity WHERE pid = pg_backend_pid()")) {
                if (!result.next()) throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.QUIESCENCE_NOT_PROVEN);
                int pid = result.getInt("pid");
                String epoch = result.getString("backend_start_epoch");
                if (pid <= 0 || epoch == null || !epoch.matches("^[1-9][0-9]*\\.[0-9]+$") || result.next())
                    throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.QUIESCENCE_NOT_PROVEN);
                phase.bindBackend(pid, epoch);
            }
            phase.assertBound();
            deps.schemaValidator().accept(pool);
            var properties = new IdentityProperties();
            properties.setSeedEnabled(false);
            properties.setCookieSecure(true);
            properties.setCorsOrigins(environment.getRequiredProperty("cms.identity.cors-origins"));
            properties.setSurfaceOrigins(environment.getRequiredProperty("cms.identity.surface-origins"));
            context.setEnvironment(environment);
            context.registerBean(DataSource.class, () -> pool, definition -> definition.setDestroyMethodName("close"));
            context.registerBean(PlatformTransactionManager.class, () -> new DataSourceTransactionManager(pool));
            context.registerBean(TransactionTemplate.class, () -> new TransactionTemplate(context.getBean(PlatformTransactionManager.class)));
            context.registerBean(JdbcIdentityStore.class, () -> new JdbcIdentityStore(pool, context.getBean(TransactionTemplate.class)));
            context.registerBean(TransactionRunner.class, () -> new TransactionRunner(pool));
            context.registerBean(IdentityProperties.class, () -> properties);
            context.registerBean(PasswordHasher.class, () -> new PasswordHasher(properties));
            context.registerBean(ObjectMapper.class, () -> new ObjectMapper());
            context.registerBean(AuditLog.class, () -> new AuditLog(context.getBean(JdbcIdentityStore.class), context.getBean(ObjectMapper.class)));
            context.registerBean(MaintenanceGuard.class, () -> guard);
            context.registerBean(ProductionIdentityService.class, () -> new ProductionIdentityService(context.getBean(JdbcIdentityStore.class),
                    context.getBean(PasswordHasher.class), context.getBean(TransactionRunner.class), context.getBean(AuditLog.class), guard));
            context.refresh();
            return context;
        } catch (Throwable failure) {
            try { context.close(); } catch (Throwable ignored) { }
            try { pool.close(); } catch (Throwable ignored) { }
            if (failure instanceof IdentityMaintenanceCommand.Failure known) throw known;
            throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.MAINTENANCE_INTERNAL_ERROR);
        }
    }

    private static StandardEnvironment productionEnvironment() {
        var environment = new StandardEnvironment();
        environment.setActiveProfiles("prod");
        var names = new HashMap<>(Map.of("cms.runtime.production-required", "CMS_RUNTIME_PRODUCTION_REQUIRED",
                "cms.runtime.site-domain", "CMS_SITE_DOMAIN", "cms.runtime.api-origin", "CMS_API_ORIGIN",
                "cms.identity.cors-origins", "CMS_CORS_ORIGINS", "cms.identity.surface-origins", "CMS_SURFACE_ORIGINS",
                "cms.identity.seed-enabled", "CMS_IDENTITY_SEED_ENABLED", "cms.identity.cookie-secure", "CMS_IDENTITY_COOKIE_SECURE",
                "cms.media.root", "CMS_MEDIA_ROOT", "spring.datasource.url", "SPRING_DATASOURCE_URL",
                "spring.datasource.username", "SPRING_DATASOURCE_USERNAME"));
        names.put("spring.datasource.password", "SPRING_DATASOURCE_PASSWORD");
        var values = new HashMap<String, Object>();
        try {
            names.forEach((key, name) -> {
                String value = environment.getProperty(name);
                if (value == null || value.isBlank()) throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.INPUT_INVALID);
                values.put(key, value);
            });
            environment.getPropertySources().addFirst(new MapPropertySource("maintenance", values));
            if (!"true".equals(values.get("cms.runtime.production-required"))
                    || URI.create(((String) values.get("spring.datasource.url")).substring(5)).getRawQuery() != null)
                throw new IllegalStateException();
            new ProductionEnvironmentValidator().postProcessEnvironment(environment, new SpringApplication());
        } catch (RuntimeException ignored) {
            throw new IdentityMaintenanceCommand.Failure(IdentityMaintenanceCommand.FailureCode.INPUT_INVALID);
        }
        return environment;
    }
}
