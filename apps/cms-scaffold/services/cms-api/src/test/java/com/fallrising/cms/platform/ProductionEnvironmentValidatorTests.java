package com.fallrising.cms.platform;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.context.config.ConfigDataEnvironmentPostProcessor;
import org.springframework.context.annotation.Configuration;
import org.springframework.mock.env.MockEnvironment;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductionEnvironmentValidatorTests {
    private final ProductionEnvironmentValidator validator = new ProductionEnvironmentValidator();
    private static final String PASSWORD = "private-test-canary-" + "x".repeat(32);
    private static final List<String> REQUIRED = List.of("cms.identity.seed-enabled", "cms.identity.cookie-secure",
            "spring.datasource.url", "spring.datasource.username", "spring.datasource.password",
            "cms.runtime.site-domain", "cms.runtime.api-origin", "cms.identity.cors-origins",
            "cms.identity.surface-origins", "cms.media.root");

    @Test
    void acceptsExplicitProductionAndUnchangedDevelopment() {
        assertThatCode(() -> validate(valid())).doesNotThrowAnyException();
        assertThatCode(() -> validate(new MockEnvironment())).doesNotThrowAnyException();
        var custom = valid().withProperty("cms.runtime.site-domain", "owned.example")
                .withProperty("cms.runtime.api-origin", "https://api.owned.example")
                .withProperty("cms.identity.cors-origins", origins("owned.example", ""))
                .withProperty("cms.identity.surface-origins", surfaces("owned.example", ""));
        assertThatCode(() -> validate(custom)).doesNotThrowAnyException();
        assertThatCode(() -> validate(valid().withProperty("cms.runtime.production-required", "false")))
                .doesNotThrowAnyException();
        assertThat(validator.getOrder()).isEqualTo(ConfigDataEnvironmentPostProcessor.ORDER + 1);
    }

    @ParameterizedTest
    @MethodSource("missingKeys")
    void PP1aFM01_missingExplicitSettingIsRejected(String key) {
        var environment = new MockEnvironment();
        environment.setActiveProfiles("prod");
        // Rebuild all fields except this one, avoiding lower-precedence fallback.
        var source = valid();
        for (String setting : REQUIRED) if (!setting.equals(key)) environment.setProperty(setting, source.getProperty(setting));
        rejects(environment);
    }

    static Stream<String> missingKeys() { return REQUIRED.stream(); }

    @ParameterizedTest
    @MethodSource("unsafeValues")
    void PP1aFM01_unsafeSettingNeverLeaksValue(String key, String value) {
        rejects(valid().withProperty(key, value));
    }

    static Stream<String[]> unsafeValues() {
        return Stream.of(
                pair("cms.identity.seed-enabled", "true"), pair("cms.identity.seed-enabled", "garbage"),
                pair("cms.identity.cookie-secure", "false"), pair("cms.identity.cookie-secure", "garbage"),
                pair("spring.datasource.username", "cms"), pair("spring.datasource.username", " "),
                pair("spring.datasource.password", "short"), pair("spring.datasource.password", " ".repeat(40)),
                pair("spring.datasource.url", "jdbc:h2:mem:test"), pair("spring.datasource.url", "jdbc:postgresql:///cms"),
                pair("spring.datasource.url", "jdbc:postgresql://postgres/"),
                pair("spring.datasource.url", "jdbc:postgresql://user:" + PASSWORD + "@postgres/cms"),
                pair("spring.datasource.url", "jdbc:postgresql://postgres/cms?%70assword=" + PASSWORD),
                pair("cms.runtime.site-domain", "localhost"), pair("cms.runtime.site-domain", "127.0.0.1"),
                pair("cms.runtime.site-domain", "CMS.test"), pair("cms.runtime.site-domain", "cms.test."),
                pair("cms.runtime.site-domain", "bad-.test"), pair("cms.runtime.site-domain", " cms.test"),
                pair("cms.runtime.api-origin", "http://api.cms.test:8443"),
                pair("cms.runtime.api-origin", "https://api.cms.test:8443/"),
                pair("cms.runtime.api-origin", "https://api.cms.test:8443?q=" + PASSWORD),
                pair("cms.runtime.api-origin", "https://api.cms.test:8443#fragment"),
                pair("cms.runtime.api-origin", "https://" + PASSWORD + "@api.cms.test:8443"),
                pair("cms.runtime.api-origin", "https://API.cms.test:8443"),
                pair("cms.runtime.api-origin", "https://back.cms.test:8443"),
                pair("cms.runtime.api-origin", "https://api.cms.test:0"),
                pair("cms.runtime.api-origin", "https://api.cms.test:443"),
                pair("cms.runtime.api-origin", "https://api.cms.test:65536"),
                pair("cms.identity.cors-origins", origins("cms.test", ":8443") + ","),
                pair("cms.identity.cors-origins", origins("cms.test", ":8443") + ",https://front.cms.test:8443"),
                pair("cms.identity.cors-origins", "*"),
                pair("cms.identity.cors-origins", origins("cms.test", ":8443").replace("front.", "other.")),
                pair("cms.identity.surface-origins", surfaces("cms.test", ":8443").replace(":front", ":admin")),
                pair("cms.identity.surface-origins", surfaces("cms.test", ":8443") + ","),
                pair("cms.media.root", "./data/media"), pair("cms.media.root", "\u0000"));
    }

    @Test
    void PP1aFM01_rejectUnsafeBeforeContext() {
        var environment = new MockEnvironment().withProperty("cms.runtime.production-required", "true");
        var initialized = new AtomicBoolean();
        var application = new SpringApplication(EmptyApplication.class);
        application.setEnvironment(environment);
        application.setWebApplicationType(WebApplicationType.NONE);
        application.setLogStartupInfo(false);
        application.addInitializers(context -> initialized.set(true));
        assertThatThrownBy(() -> {
            try (var ignored = application.run()) { }
        }).isInstanceOf(IllegalStateException.class).hasMessage("PP1_PROD_PROFILE_REQUIRED").hasNoCause();
        assertThat(initialized).isFalse();
    }

    @Test
    void productionCannotOptOutAndRequiredCannotLoseProfile() {
        rejects(valid().withProperty("cms.runtime.production-required", "false")
                .withProperty("cms.identity.seed-enabled", "true"));
        assertThatThrownBy(() -> validate(new MockEnvironment().withProperty("cms.runtime.production-required", "true")))
                .hasMessage("PP1_PROD_PROFILE_REQUIRED").hasNoCause();
    }

    @Test
    void PP1aFM01_prodConfigIsRejectedBeforeAnyInitializer() {
        var initialized = new AtomicBoolean();
        var application = new SpringApplication(EmptyApplication.class);
        application.setEnvironment(valid().withProperty("spring.datasource.password", "short"));
        application.setWebApplicationType(WebApplicationType.NONE);
        application.setLogStartupInfo(false);
        application.addInitializers(context -> initialized.set(true));
        assertThatThrownBy(() -> {
            try (var ignored = application.run()) { }
        }).hasMessage("PP1_PROD_CONFIG_INVALID").hasNoCause();
        assertThat(initialized).isFalse();
    }

    private void rejects(MockEnvironment environment) {
        assertThatThrownBy(() -> validate(environment)).isInstanceOf(IllegalStateException.class)
                .hasMessage("PP1_PROD_CONFIG_INVALID").hasNoCause();
    }

    private void validate(MockEnvironment environment) { validator.postProcessEnvironment(environment, new SpringApplication()); }
    private static String[] pair(String key, String value) { return new String[]{key, value}; }
    private static String origins(String domain, String port) {
        return "https://front." + domain + port + ",https://back." + domain + port + ",https://admin." + domain + port;
    }
    private static String surfaces(String domain, String port) {
        return "https://front." + domain + port + ":front,https://back." + domain + port + ":back,https://admin." + domain + port + ":admin";
    }
    private static MockEnvironment valid() {
        var environment = new MockEnvironment().withProperty("cms.identity.seed-enabled", "false")
                .withProperty("cms.identity.cookie-secure", "true")
                .withProperty("spring.datasource.url", "jdbc:postgresql://postgres:5432/cms")
                .withProperty("spring.datasource.username", "cms_local").withProperty("spring.datasource.password", PASSWORD)
                .withProperty("cms.runtime.site-domain", "cms.test").withProperty("cms.runtime.api-origin", "https://api.cms.test:8443")
                .withProperty("cms.identity.cors-origins", origins("cms.test", ":8443"))
                .withProperty("cms.identity.surface-origins", surfaces("cms.test", ":8443"))
                .withProperty("cms.media.root", "/data/media");
        environment.setActiveProfiles("prod");
        return environment;
    }

    @Configuration(proxyBeanMethods = false)
    static class EmptyApplication { }
}
