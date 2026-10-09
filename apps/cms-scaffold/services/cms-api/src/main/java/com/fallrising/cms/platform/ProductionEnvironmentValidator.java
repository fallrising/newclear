package com.fallrising.cms.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.Profiles;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

public class ProductionEnvironmentValidator implements EnvironmentPostProcessor, Ordered {
    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        boolean production = environment.acceptsProfiles(Profiles.of("prod"));
        try {
            if (!production) {
                if ("true".equalsIgnoreCase(environment.getProperty("cms.runtime.production-required"))) {
                    throw new IllegalStateException("PP1_PROD_PROFILE_REQUIRED");
                }
                return;
            }
            validate(environment);
        } catch (RuntimeException ignored) {
            // Neither input values nor parsing/placeholder exceptions cross this boundary.
            throw new IllegalStateException(production ? "PP1_PROD_CONFIG_INVALID" : "PP1_PROD_PROFILE_REQUIRED");
        }
    }

    @Override
    public int getOrder() {
        return ConfigDataEnvironmentPostProcessor.ORDER + 1;
    }

    private static void validate(ConfigurableEnvironment environment) {
        require("false".equals(environment.getProperty("cms.identity.seed-enabled")));
        require("true".equals(environment.getProperty("cms.identity.cookie-secure")));
        String username = required(environment, "spring.datasource.username");
        require(!"cms".equalsIgnoreCase(username.trim()));
        require(required(environment, "spring.datasource.password").length() >= 32);
        String jdbc = required(environment, "spring.datasource.url");
        require(jdbc.startsWith("jdbc:postgresql://"));
        URI database = URI.create(jdbc.substring(5));
        require(database.getHost() != null && !database.getHost().isBlank() && database.getRawUserInfo() == null);
        require(database.getPath() != null && database.getPath().length() > 1 && !database.getPath().substring(1).isBlank());
        require(database.getFragment() == null);
        if (database.getRawQuery() != null) {
            for (String parameter : database.getRawQuery().split("&", -1)) {
                String key = URLDecoder.decode(parameter.split("=", 2)[0], StandardCharsets.UTF_8);
                require(!"password".equalsIgnoreCase(key));
            }
        }
        String domain = required(environment, "cms.runtime.site-domain");
        require(domain.length() <= 253 && !domain.matches("[0-9]+(?:\\.[0-9]+){3}"));
        String[] labels = domain.split("\\.", -1);
        require(labels.length >= 2);
        for (String label : labels) require(label.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"));

        String api = required(environment, "cms.runtime.api-origin");
        URI origin = URI.create(api);
        require("https".equals(origin.getScheme()) && ("api." + domain).equals(origin.getHost()));
        require(origin.getRawUserInfo() == null && origin.getRawQuery() == null && origin.getRawFragment() == null);
        require(origin.getRawPath().isEmpty());
        int port = origin.getPort();
        require(port == -1 || port >= 1 && port <= 65535 && port != 443);
        String portSuffix = port == -1 ? "" : ":" + port;
        require(api.equals("https://api." + domain + portSuffix));
        Map<String, String> expected = Map.of(
                "front", "https://front." + domain + portSuffix,
                "back", "https://back." + domain + portSuffix,
                "admin", "https://admin." + domain + portSuffix);
        Set<String> cors = csv(required(environment, "cms.identity.cors-origins"));
        require(cors.equals(new HashSet<>(expected.values())));
        Set<String> surfaces = csv(required(environment, "cms.identity.surface-origins"));
        require(surfaces.size() == 3);
        for (String mapping : surfaces) {
            int separator = mapping.lastIndexOf(':');
            require(separator > 0);
            String surface = mapping.substring(separator + 1);
            require(mapping.substring(0, separator).equals(expected.get(surface)));
        }
        require(Path.of(required(environment, "cms.media.root")).isAbsolute());
    }

    private static String required(ConfigurableEnvironment environment, String key) {
        String value = environment.getProperty(key);
        require(value != null && !value.isBlank());
        return value;
    }

    private static Set<String> csv(String input) {
        String[] items = Arrays.stream(input.split(",", -1)).map(String::trim).toArray(String[]::new);
        Set<String> unique = new HashSet<>(Arrays.asList(items));
        require(!unique.contains("") && unique.size() == items.length);
        return unique;
    }

    private static void require(boolean valid) {
        if (!valid) throw new IllegalStateException("PP1_PROD_CONFIG_INVALID");
    }
}
